import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/app/lib/auth/session";
import { enqueueJob, findActiveJobForUserKindTicker, findJobForUserByIdempotency } from "@/app/lib/jobs/store";
import { initJobWorker, scheduleJobProcessing } from "@/app/lib/jobs/processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InferRequest = {
  ticker?: string;
  retrain?: boolean;
  idempotencyKey?: string;
};

function normalizeTicker(input: string): string {
  return input.trim().toUpperCase();
}

function isValidTicker(ticker: string): boolean {
  return /^[A-Z0-9.\-]{1,12}$/.test(ticker);
}

export async function POST(request: NextRequest) {
  try {
    initJobWorker();

    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as InferRequest;
    const ticker = normalizeTicker(body.ticker ?? "");
    const retrain = Boolean(body.retrain);
    const idempotencyKeyRaw = body.idempotencyKey ?? request.headers.get("x-idempotency-key") ?? "";
    const idempotencyKey = String(idempotencyKeyRaw).trim().slice(0, 128);

    if (!ticker || !isValidTicker(ticker)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid ticker. Use 1-12 chars: letters, numbers, dot, hyphen."
        },
        { status: 400 }
      );
    }

    if (idempotencyKey) {
      const existingByKey = await findJobForUserByIdempotency({
        userId: session.userId,
        kind: "quant",
        idempotencyKey
      });
      if (existingByKey) {
        scheduleJobProcessing(existingByKey.id);
        return NextResponse.json({
          ok: true,
          jobId: existingByKey.id,
          status: existingByKey.status,
          reused: true
        });
      }
    }

    const existing = await findActiveJobForUserKindTicker({
      userId: session.userId,
      kind: "quant",
      ticker
    });
    if (existing) {
      scheduleJobProcessing(existing.id);
      return NextResponse.json({
        ok: true,
        jobId: existing.id,
        status: existing.status,
        reused: true
      });
    }

    const job = await enqueueJob({
      userId: session.userId,
      kind: "quant",
      idempotencyKey: idempotencyKey || null,
      payload: {
        ticker,
        retrain
      }
    });

    scheduleJobProcessing(job.id);

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      status: job.status,
      reused: false
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not enqueue quant job.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
