import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { isWithinIdempotencyWindow } from "@/app/lib/jobs/lifecycle";
import { parseQuantInferRequest } from "@/app/lib/jobs/request-schemas";
import { enqueueJob, findActiveJobForUserKindTicker, findJobForUserByIdempotency } from "@/app/lib/jobs/store";
import { initJobWorker, scheduleJobProcessing } from "@/app/lib/jobs/processor";
import { recordFunnelEvent } from "@/app/lib/analytics/funnel-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    initJobWorker();

    const session = await getAuthenticatedSession(request);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = parseQuantInferRequest(body, request.headers.get("x-idempotency-key"));
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }
    const { ticker, retrain, idempotencyKey } = parsed.value;

    if (idempotencyKey) {
      const windowHoursRaw = Number(process.env.JOB_IDEMPOTENCY_WINDOW_HOURS ?? "24");
      const windowHours = Number.isFinite(windowHoursRaw) && windowHoursRaw > 0 ? windowHoursRaw : 24;
      const existingByKey = await findJobForUserByIdempotency({
        userId: session.userId,
        kind: "quant",
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

    // Recorded at enqueue, not on completion. Two reasons, and the second is the
    // binding one: a funnel measures what the user did, and they did this now —
    // and the worker finishes minutes later with no request in scope, so it has
    // no consent cookie to check and therefore no lawful basis to write
    // (app/lib/analytics/funnel-store.ts). The audit event still fires on the
    // outcome in app/lib/jobs/processor.ts. Only a genuinely new job counts; the
    // idempotent and already-running replies above returned an existing run.
    void recordFunnelEvent(request, "quant_run", {
      userId: session.userId,
      path: "/quant"
    });

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      status: job.status,
      reused: false
    });
  } catch (error) {
    let message = error instanceof Error ? error.message : "Could not enqueue quant job.";
    if (message.toLowerCase().includes("supabase network request failed")) {
      message =
        "Could not reach the jobs database (Supabase). Check SUPABASE_URL/SUPABASE_KEY and outbound network access from the Next.js server.";
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
