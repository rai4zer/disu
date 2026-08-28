import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
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

  if (job.status !== "failed" && job.status !== "succeeded") {
    return NextResponse.json({ ok: false, error: "Only terminal jobs can be dismissed." }, { status: 409 });
  }

  const updated = await updateJobForUser(job.id, session.userId, {
    dismissed_at: new Date().toISOString()
  });

  if (!updated) {
    // Only reachable if the job vanished between the read and the write.
    return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    jobId: updated.id,
    dismissedAt: updated.dismissed_at
  });
}
