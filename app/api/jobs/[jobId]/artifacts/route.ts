import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { getJobForUser, listJobArtifactsForUser } from "@/app/lib/jobs/store";

export async function GET(
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

  const artifacts = await listJobArtifactsForUser({
    userId: session.userId,
    jobId: job.id
  });

  return NextResponse.json({
    ok: true,
    jobId: job.id,
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      artifactType: artifact.artifact_type,
      artifactPath: artifact.artifact_path,
      contentHash: artifact.content_hash,
      metadata: artifact.metadata,
      createdAt: artifact.created_at
    }))
  });
}
