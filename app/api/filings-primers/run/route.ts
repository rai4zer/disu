import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/app/lib/auth/session";
import { enqueueJob, findActiveJobForUserKindTicker, findJobForUserByIdempotency } from "@/app/lib/jobs/store";
import { initJobWorker, scheduleJobProcessing } from "@/app/lib/jobs/processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RunPrimersRequest = {
  ticker?: string;
  llmProvider?: "none" | "openai_compatible";
  idempotencyKey?: string;
};

function normalizeTicker(input: string): string {
  return input.trim().toUpperCase();
}

function isValidTicker(ticker: string): boolean {
  return /^[A-Z0-9.\-]{1,12}$/.test(ticker);
}

export async function POST(request: NextRequest) {
  initJobWorker();

  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as RunPrimersRequest;
  const ticker = normalizeTicker(body.ticker ?? "");
  const llmProvider = "openai_compatible" as const;
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
      kind: "primer",
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
    kind: "primer",
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
    kind: "primer",
    idempotencyKey: idempotencyKey || null,
    payload: {
      ticker,
      llmProvider
    }
  });

  scheduleJobProcessing(job.id);

  return NextResponse.json({
    ok: true,
    jobId: job.id,
    status: job.status,
    reused: false
  });
}
