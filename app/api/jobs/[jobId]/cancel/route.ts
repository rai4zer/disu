import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { cancelRunningJob } from "@/app/lib/jobs/processor";
import { getJobForUser, updateJobForUser } from "@/app/lib/jobs/store";

export async function POST(
  request: NextRequest,
  context: { params: { jobId: string } }
) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const job = await getJobForUser(context.params.jobId, session.userId);
  if (!job) {
    return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
  }

  if (job.status === "succeeded") {
    return NextResponse.json({ ok: false, error: "Cannot cancel a completed job." }, { status: 409 });
  }
  if (job.status === "failed") {
    return NextResponse.json({
      ok: true,
      jobId: job.id,
      status: job.status,
      stage: job.stage,
      alreadyTerminal: true
    });
  }

  cancelRunningJob(job.id);

  const updated = await updateJobForUser(job.id, session.userId, {
    status: "failed",
    stage: "failed",
    error: "Cancelled by user.",
    error_code: "cancelled_by_user",
    finished_at: new Date().toISOString(),
    dismissed_at: null
  });

  if (!updated) {
    // Only reachable if the job vanished between the read and the write.
    return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    jobId: updated.id,
    status: updated.status,
    stage: updated.stage
  });
}
