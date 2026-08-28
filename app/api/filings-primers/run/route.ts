import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { isWithinIdempotencyWindow } from "@/app/lib/jobs/lifecycle";
import { parsePrimerRunRequest } from "@/app/lib/jobs/request-schemas";
import { enqueueJob, findActiveJobForUserKindTicker, findJobForUserByIdempotency } from "@/app/lib/jobs/store";
import { initJobWorker, scheduleJobProcessing } from "@/app/lib/jobs/processor";
import { recordFunnelEvent } from "@/app/lib/analytics/funnel-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  initJobWorker();

  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const defaultProviderRaw = (process.env.PRIMER_LLM_PROVIDER_DEFAULT ?? "openai_compatible").trim().toLowerCase();
  const defaultLlmProvider: "openai_compatible" | "none" =
    defaultProviderRaw === "none" ? "none" : "openai_compatible";
  const allowProviderOverride = (process.env.PRIMER_LLM_PROVIDER_ALLOW_OVERRIDE ?? "0").trim() === "1";

  const body = await request.json().catch(() => ({}));
  const parsed = parsePrimerRunRequest(body, request.headers.get("x-idempotency-key"), {
    defaultLlmProvider,
    allowProviderOverride
  });
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  const { ticker, llmProvider, idempotencyKey } = parsed.value;

  if (idempotencyKey) {
    const windowHoursRaw = Number(process.env.JOB_IDEMPOTENCY_WINDOW_HOURS ?? "24");
    const windowHours = Number.isFinite(windowHoursRaw) && windowHoursRaw > 0 ? windowHoursRaw : 24;
    const existingByKey = await findJobForUserByIdempotency({
      userId: session.userId,
      kind: "primer",
      idempotencyKey
    });
    if (existingByKey) {
      const fresh = isWithinIdempotencyWindow({
        createdAt: existingByKey.created_at,
        nowMs: Date.now(),
        windowHours
      });
      if (!fresh) {
        return NextResponse.json(
          {
            ok: false,
            error: `Idempotency key replay window expired (${windowHours}h). Submit with a new idempotency key.`
          },
          { status: 409 }
        );
      }
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

  // At enqueue, for the reasons spelled out in app/api/quant/infer/route.ts.
  void recordFunnelEvent(request, "primer_run", {
    userId: session.userId,
    path: "/filings-primers"
  });

  return NextResponse.json({
    ok: true,
    jobId: job.id,
    status: job.status,
    reused: false
  });
}
