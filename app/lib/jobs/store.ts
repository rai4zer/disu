import { randomUUID } from "node:crypto";
import { eq, lt } from "@/app/lib/db/supabase";
import { systemRequest, userScoped } from "@/app/lib/db/user-scope";
import type { JobArtifactRow, JobArtifactType, JobKind, JobPayload, JobRow, JobStatus } from "@/app/lib/jobs/types";

const JOB_SELECT_FIELDS =
  "id,user_id,kind,status,stage,idempotency_key,payload,result,error,error_code,attempts,max_attempts,queued_ms,fetch_ms,run_ms,run_after,dismissed_at,started_at,finished_at,created_at,updated_at";

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
  const rows = await userScoped<JobRow[]>(input.userId, "jobs", {
    method: "POST",
    body: [
      {
        id: createJobId(),
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
        dismissed_at: null,
        started_at: null,
        finished_at: null,
        created_at: now,
        updated_at: now
      }
    ]
  });

  return rows[0];
}

/**
 * Unscoped by design: the worker resolves a job id it pulled off the queue and
 * has no session. Never call this from a route — routes must use
 * `getJobForUser()` so a guessed id cannot read another account's job.
 */
export async function getJobById(jobId: string): Promise<JobRow | null> {
  const rows = await systemRequest<JobRow[]>("jobs", {
    reason: "job worker resolves a queued job id with no session attached",
    query: {
      id: eq(jobId),
      select: JOB_SELECT_FIELDS,
      limit: "1"
    }
  });
  return rows[0] ?? null;
}

export async function getJobForUser(jobId: string, userId: string): Promise<JobRow | null> {
  const rows = await userScoped<JobRow[]>(userId, "jobs", {
    query: {
      id: eq(jobId),
      select: JOB_SELECT_FIELDS,
      limit: "1"
    }
  });
  return rows[0] ?? null;
}

export async function listQueuedJobs(limit = 100): Promise<JobRow[]> {
  return systemRequest<JobRow[]>("jobs", {
    reason: "job worker drains the queue across all tenants",
    query: {
      status: eq("queued"),
      dismissed_at: "is.null",
      select: JOB_SELECT_FIELDS,
      order: "run_after.asc",
      limit: String(limit)
    }
  });
}

export async function listRunningJobs(limit = 100): Promise<JobRow[]> {
  return systemRequest<JobRow[]>("jobs", {
    reason: "orphan-job recovery scans every tenant's in-flight jobs",
    query: {
      status: eq("running"),
      dismissed_at: "is.null",
      select: JOB_SELECT_FIELDS,
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
  const rows = await userScoped<JobRow[]>(input.userId, "jobs", {
    query: {
      kind: eq(input.kind),
      status: `in.("queued","running")`,
      "payload->>ticker": eq(input.ticker),
      dismissed_at: "is.null",
      select: JOB_SELECT_FIELDS,
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
  const rows = await userScoped<JobRow[]>(input.userId, "jobs", {
    query: {
      kind: eq(input.kind),
      idempotency_key: eq(input.idempotencyKey),
      select: JOB_SELECT_FIELDS,
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
    dismissed_at: "is.null",
    select: JOB_SELECT_FIELDS,
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

  return userScoped<JobRow[]>(input.userId, "jobs", { query });
}

/**
 * Unscoped by design: the worker advances jobs it owns off the queue. Routes
 * must use `updateJobForUser()` instead.
 */
export async function updateJob(jobId: string, patch: Record<string, unknown>): Promise<JobRow> {
  const rows = await systemRequest<JobRow[]>("jobs", {
    reason: "job worker advances the lifecycle of a job it claimed from the queue",
    method: "PATCH",
    query: {
      id: eq(jobId),
      select: JOB_SELECT_FIELDS
    },
    body: {
      ...patch,
      updated_at: new Date().toISOString()
    }
  });
  return rows[0];
}

/**
 * The route-facing update. Returns null when the id is not this user's, so a
 * caller cannot mutate a job it merely guessed the id of — the `user_id` filter
 * is part of the write itself rather than a separate read the caller has to
 * remember to perform first.
 */
export async function updateJobForUser(
  jobId: string,
  userId: string,
  patch: Record<string, unknown>
): Promise<JobRow | null> {
  const rows = await userScoped<JobRow[]>(userId, "jobs", {
    method: "PATCH",
    query: {
      id: eq(jobId),
      select: JOB_SELECT_FIELDS
    },
    body: {
      ...patch,
      updated_at: new Date().toISOString()
    }
  });
  return rows[0] ?? null;
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

  // Grouped by owner so each insert is scoped to exactly one user. In practice
  // every batch comes from a single job, but the signature allows a mix and a
  // silently mis-owned artifact row is a leak.
  const byUser = new Map<string, typeof artifacts>();
  for (const artifact of artifacts) {
    const bucket = byUser.get(artifact.userId);
    if (bucket) {
      bucket.push(artifact);
    } else {
      byUser.set(artifact.userId, [artifact]);
    }
  }

  const inserted = await Promise.all(
    [...byUser.entries()].map(([userId, owned]) =>
      userScoped<JobArtifactRow[]>(userId, "job_artifacts", {
        method: "POST",
        body: owned.map((artifact) => ({
          id: createArtifactId(),
          job_id: artifact.jobId,
          kind: artifact.kind,
          artifact_type: artifact.artifactType,
          artifact_path: artifact.artifactPath,
          content_hash: artifact.contentHash ?? null,
          metadata: artifact.metadata ?? {},
          created_at: new Date().toISOString()
        }))
      })
    )
  );

  return inserted.flat();
}

export async function listJobArtifactsForUser(input: {
  userId: string;
  jobId: string;
}): Promise<JobArtifactRow[]> {
  return userScoped<JobArtifactRow[]>(input.userId, "job_artifacts", {
    query: {
      job_id: eq(input.jobId),
      select: "id,job_id,user_id,kind,artifact_type,artifact_path,content_hash,metadata,created_at",
      order: "created_at.desc"
    }
  });
}

export async function cleanupOldJobArtifacts(olderThanIso: string): Promise<number> {
  const deleted = await systemRequest<Array<{ id: string }>>("job_artifacts", {
    reason: "retention pruning is defined by age, across all tenants",
    method: "DELETE",
    query: {
      created_at: lt(olderThanIso),
      select: "id"
    },
    prefer: "return=representation,count=exact"
  });
  return deleted.length;
}

export async function cleanupOldTerminalJobs(olderThanIso: string): Promise<number> {
  const deleted = await systemRequest<Array<{ id: string }>>("jobs", {
    reason: "retention pruning is defined by age, across all tenants",
    method: "DELETE",
    query: {
      status: `in.("succeeded","failed")`,
      created_at: lt(olderThanIso),
      select: "id"
    },
    prefer: "return=representation,count=exact"
  });
  return deleted.length;
}
