import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/app/lib/auth/session";
import { initJobWorker, scheduleJobProcessing } from "@/app/lib/jobs/processor";
import { getJobForUser, updateJob } from "@/app/lib/jobs/store";

export async function POST(
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

  if (job.status === "queued" || job.status === "running") {
    scheduleJobProcessing(job.id);
    return NextResponse.json({
      ok: true,
      jobId: job.id,
      status: job.status,
      stage: job.stage,
      reused: true
    });
  }

  if (job.status === "succeeded") {
    return NextResponse.json({ ok: false, error: "Completed jobs cannot be retried." }, { status: 409 });
  }

  const updated = await updateJob(job.id, {
    status: "queued",
    stage: "queued",
    error: null,
    error_code: null,
    queued_ms: null,
    fetch_ms: null,
    run_ms: null,
    run_after: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    result: null,
    attempts: 0
  });

  scheduleJobProcessing(updated.id);

  return NextResponse.json({
    ok: true,
    jobId: updated.id,
    status: updated.status,
    stage: updated.stage,
    reused: false
  });
}
