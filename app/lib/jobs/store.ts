import { randomUUID } from "node:crypto";
import { eq, lt, supabaseRequest } from "@/app/lib/db/supabase";
import type { JobArtifactRow, JobArtifactType, JobKind, JobPayload, JobRow, JobStatus } from "@/app/lib/jobs/types";

function createJobId(): string {
  return `job_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

export async function enqueueJob(input: {
  userId: string;
  kind: JobKind;
  payload: JobPayload;
  idempotencyKey?: string | null;
  maxAttempts?: number;
}): Promise<JobRow> {
  const now = new Date().toISOString();
  const rows = await supabaseRequest<JobRow[]>("jobs", {
    method: "POST",
    body: [
      {
        id: createJobId(),
        user_id: input.userId,
        kind: input.kind,
        status: "queued",
        stage: "queued",
        idempotency_key: input.idempotencyKey ?? null,
        payload: input.payload,
        result: null,
        error: null,
        error_code: null,
        attempts: 0,
        max_attempts: input.maxAttempts ?? 2,
        queued_ms: null,
        fetch_ms: null,
        run_ms: null,
        run_after: now,
        started_at: null,
        finished_at: null,
        created_at: now,
        updated_at: now
      }
    ]
  });

  return rows[0];
}

export async function getJobById(jobId: string): Promise<JobRow | null> {
  const rows = await supabaseRequest<JobRow[]>("jobs", {
    query: {
      id: eq(jobId),
      select: "id,user_id,kind,status,stage,idempotency_key,payload,result,error,error_code,attempts,max_attempts,queued_ms,fetch_ms,run_ms,run_after,started_at,finished_at,created_at,updated_at",
      limit: "1"
    }
  });
  return rows[0] ?? null;
}

export async function getJobForUser(jobId: string, userId: string): Promise<JobRow | null> {
  const rows = await supabaseRequest<JobRow[]>("jobs", {
    query: {
      id: eq(jobId),
      user_id: eq(userId),
      select: "id,user_id,kind,status,stage,idempotency_key,payload,result,error,error_code,attempts,max_attempts,queued_ms,fetch_ms,run_ms,run_after,started_at,finished_at,created_at,updated_at",
      limit: "1"
    }
  });
  return rows[0] ?? null;
}

export async function listQueuedJobs(limit = 100): Promise<JobRow[]> {
  return supabaseRequest<JobRow[]>("jobs", {
    query: {
      status: eq("queued"),
      select: "id,user_id,kind,status,stage,idempotency_key,payload,result,error,error_code,attempts,max_attempts,queued_ms,fetch_ms,run_ms,run_after,started_at,finished_at,created_at,updated_at",
      order: "run_after.asc",
      limit: String(limit)
    }
  });
}

export async function listRunningJobs(limit = 100): Promise<JobRow[]> {
  return supabaseRequest<JobRow[]>("jobs", {
    query: {
      status: eq("running"),
      select: "id,user_id,kind,status,stage,idempotency_key,payload,result,error,error_code,attempts,max_attempts,queued_ms,fetch_ms,run_ms,run_after,started_at,finished_at,created_at,updated_at",
      order: "started_at.asc",
      limit: String(limit)
    }
  });
}

export async function findActiveJobForUserKindTicker(input: {
  userId: string;
  kind: JobKind;
  ticker: string;
}): Promise<JobRow | null> {
  const rows = await supabaseRequest<JobRow[]>("jobs", {
    query: {
      user_id: eq(input.userId),
      kind: eq(input.kind),
      status: `in.("queued","running")`,
      "payload->>ticker": eq(input.ticker),
      select: "id,user_id,kind,status,stage,idempotency_key,payload,result,error,error_code,attempts,max_attempts,queued_ms,fetch_ms,run_ms,run_after,started_at,finished_at,created_at,updated_at",
      order: "created_at.desc",
      limit: "1"
    }
  });
  return rows[0] ?? null;
}

export async function findJobForUserByIdempotency(input: {
  userId: string;
  kind: JobKind;
  idempotencyKey: string;
}): Promise<JobRow | null> {
  const rows = await supabaseRequest<JobRow[]>("jobs", {
    query: {
      user_id: eq(input.userId),
      kind: eq(input.kind),
      idempotency_key: eq(input.idempotencyKey),
      select: "id,user_id,kind,status,stage,idempotency_key,payload,result,error,error_code,attempts,max_attempts,queued_ms,fetch_ms,run_ms,run_after,started_at,finished_at,created_at,updated_at",
      order: "created_at.desc",
      limit: "1"
    }
  });
  return rows[0] ?? null;
}

export async function listRecentJobsForUser(input: {
  userId: string;
  limit?: number;
  kinds?: JobKind[];
  statuses?: JobStatus[];
}): Promise<JobRow[]> {
  const limit = Math.max(1, Math.min(100, input.limit ?? 10));
  const query: Record<string, string> = {
    user_id: eq(input.userId),
    select: "id,user_id,kind,status,stage,idempotency_key,payload,result,error,error_code,attempts,max_attempts,queued_ms,fetch_ms,run_ms,run_after,started_at,finished_at,created_at,updated_at",
    order: "created_at.desc",
    limit: String(limit)
  };

  if (input.kinds && input.kinds.length > 0) {
    const encodedKinds = input.kinds.map((kind) => `"${kind}"`).join(",");
    query.kind = `in.(${encodedKinds})`;
  }

  if (input.statuses && input.statuses.length > 0) {
    const encodedStatuses = input.statuses.map((status) => `"${status}"`).join(",");
    query.status = `in.(${encodedStatuses})`;
  }

  return supabaseRequest<JobRow[]>("jobs", { query });
}

export async function updateJob(jobId: string, patch: Record<string, unknown>): Promise<JobRow> {
  const rows = await supabaseRequest<JobRow[]>("jobs", {
    method: "PATCH",
    query: {
      id: eq(jobId),
      select: "id,user_id,kind,status,stage,idempotency_key,payload,result,error,error_code,attempts,max_attempts,queued_ms,fetch_ms,run_ms,run_after,started_at,finished_at,created_at,updated_at"
    },
    body: {
      ...patch,
      updated_at: new Date().toISOString()
    }
  });
  return rows[0];
}

export async function setJobStatus(jobId: string, status: JobStatus): Promise<JobRow> {
  return updateJob(jobId, { status });
}

function createArtifactId(): string {
  return `art_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export async function insertJobArtifacts(
  artifacts: Array<{
    jobId: string;
    userId: string;
    kind: JobKind;
    artifactType: JobArtifactType;
    artifactPath: string;
    contentHash?: string | null;
    metadata?: Record<string, unknown>;
  }>
): Promise<JobArtifactRow[]> {
  if (artifacts.length === 0) {
    return [];
  }

  return supabaseRequest<JobArtifactRow[]>("job_artifacts", {
    method: "POST",
    body: artifacts.map((artifact) => ({
      id: createArtifactId(),
      job_id: artifact.jobId,
      user_id: artifact.userId,
      kind: artifact.kind,
      artifact_type: artifact.artifactType,
      artifact_path: artifact.artifactPath,
      content_hash: artifact.contentHash ?? null,
      metadata: artifact.metadata ?? {},
      created_at: new Date().toISOString()
    }))
  });
}

export async function listJobArtifactsForUser(input: {
  userId: string;
  jobId: string;
}): Promise<JobArtifactRow[]> {
  return supabaseRequest<JobArtifactRow[]>("job_artifacts", {
    query: {
      user_id: eq(input.userId),
      job_id: eq(input.jobId),
      select: "id,job_id,user_id,kind,artifact_type,artifact_path,content_hash,metadata,created_at",
      order: "created_at.desc"
    }
  });
}

export async function cleanupOldJobArtifacts(olderThanIso: string): Promise<void> {
  await supabaseRequest<unknown>("job_artifacts", {
    method: "DELETE",
    query: {
      created_at: lt(olderThanIso)
    },
    prefer: "return=minimal"
  });
}

export async function cleanupOldTerminalJobs(olderThanIso: string): Promise<void> {
  await supabaseRequest<unknown>("jobs", {
    method: "DELETE",
    query: {
      status: `in.("succeeded","failed")`,
      created_at: lt(olderThanIso)
    },
    prefer: "return=minimal"
  });
}
