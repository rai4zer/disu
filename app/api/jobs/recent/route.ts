import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { initJobWorker } from "@/app/lib/jobs/processor";
import { listRecentJobsForUser } from "@/app/lib/jobs/store";
import type { JobKind, JobStatus } from "@/app/lib/jobs/types";

const ALLOWED_KINDS: JobKind[] = ["quant", "primer"];
const ALLOWED_STATUSES: JobStatus[] = ["queued", "running", "succeeded", "failed"];

function parseKinds(raw: string | null): JobKind[] {
  if (!raw) {
    return ALLOWED_KINDS;
  }
  const items = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const kinds = items.filter((item): item is JobKind => ALLOWED_KINDS.includes(item as JobKind));
  return kinds.length > 0 ? kinds : ALLOWED_KINDS;
}

function parseStatuses(raw: string | null): JobStatus[] {
  if (!raw) {
    return ["queued", "running", "succeeded"];
  }
  const items = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const statuses = items.filter((item): item is JobStatus => ALLOWED_STATUSES.includes(item as JobStatus));
  return statuses.length > 0 ? statuses : ["queued", "running", "succeeded"];
}

function parseLimit(raw: string | null): number {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed)) {
    return 10;
  }
  return Math.max(1, Math.min(30, Math.trunc(parsed)));
}

export async function GET(request: NextRequest) {
  initJobWorker();

  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const kinds = parseKinds(searchParams.get("kinds"));
  const statuses = parseStatuses(searchParams.get("statuses"));
  const limit = parseLimit(searchParams.get("limit"));

  const jobs = await listRecentJobsForUser({
    userId: session.userId,
    limit,
    kinds,
    statuses
  });

  return NextResponse.json({
    ok: true,
    jobs: jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      status: job.status,
      stage: job.stage,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      timings: {
        queuedMs: job.queued_ms,
        fetchMs: job.fetch_ms,
        runMs: job.run_ms
      },
      error: job.error,
      errorCode: job.error_code,
      payload: job.payload,
      createdAt: job.created_at,
      startedAt: job.started_at,
      finishedAt: job.finished_at
    }))
  });
}
