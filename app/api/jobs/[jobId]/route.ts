import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/app/lib/auth/session";
import { initJobWorker } from "@/app/lib/jobs/processor";
import { getJobForUser } from "@/app/lib/jobs/store";

export async function GET(
  request: NextRequest,
  context: { params: { jobId: string } }
) {
  initJobWorker();

  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const job = await getJobForUser(context.params.jobId, session.userId);
  if (!job) {
    return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    job: {
      id: job.id,
      kind: job.kind,
      status: job.status,
      stage: job.stage,
      idempotencyKey: job.idempotency_key,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      timings: {
        queuedMs: job.queued_ms,
        fetchMs: job.fetch_ms,
        runMs: job.run_ms
      },
      error: job.error,
      errorCode: job.error_code,
      result: job.result,
      createdAt: job.created_at,
      startedAt: job.started_at,
      finishedAt: job.finished_at
    }
  });
}
