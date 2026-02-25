export type JobKind = "quant" | "primer";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type JobStage = "queued" | "fetching" | "running" | "done" | "failed";

export type JobStatusRecord = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  stage?: JobStage;
  idempotencyKey?: string | null;
  timings?: {
    queuedMs?: number | null;
    fetchMs?: number | null;
    runMs?: number | null;
  };
  result: unknown;
  error: string | null;
  createdAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  payload?: Record<string, unknown>;
};

type JobStatusResponse = {
  ok: true;
  job: JobStatusRecord;
};

type RecentJobsResponse = {
  ok: true;
  jobs: Array<{
    id: string;
    kind: JobKind;
    status: JobStatus;
    stage?: JobStage;
    timings?: {
      queuedMs?: number | null;
      fetchMs?: number | null;
      runMs?: number | null;
    };
    payload?: Record<string, unknown>;
    error?: string | null;
    createdAt?: string;
    startedAt?: string | null;
    finishedAt?: string | null;
  }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getJobStatus(jobId: string): Promise<JobStatusRecord> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: "GET",
    cache: "no-store"
  });
  const payload = (await response.json()) as JobStatusResponse | { ok: false; error: string };
  if (!payload.ok) {
    throw new Error(payload.error);
  }
  return payload.job;
}

export async function pollJobResult<T>(jobId: string, attempts = 120, intervalMs = 2000): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(intervalMs);
    const job = await getJobStatus(jobId);
    if (job.status === "queued" || job.status === "running") {
      continue;
    }
    if (job.status === "failed") {
      throw new Error(job.error ?? "Job failed");
    }
    return job.result as T;
  }
  throw new Error("Job timed out while polling status.");
}

export async function pollJobResultWithProgress<T>(
  jobId: string,
  options?: {
    attempts?: number;
    intervalMs?: number;
    onProgress?: (job: JobStatusRecord) => void;
  }
): Promise<T> {
  const attempts = options?.attempts ?? 120;
  const intervalMs = options?.intervalMs ?? 2000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(intervalMs);
    const job = await getJobStatus(jobId);
    options?.onProgress?.(job);
    if (job.status === "queued" || job.status === "running") {
      continue;
    }
    if (job.status === "failed") {
      throw new Error(job.error ?? "Job failed");
    }
    return job.result as T;
  }
  throw new Error("Job timed out while polling status.");
}

export async function getRecentJobs(kind: JobKind, limit = 8): Promise<RecentJobsResponse["jobs"]> {
  const response = await fetch(
    `/api/jobs/recent?kinds=${encodeURIComponent(kind)}&statuses=queued,running,succeeded,failed&limit=${Math.max(1, Math.min(30, limit))}`,
    {
      method: "GET",
      cache: "no-store"
    }
  );
  const payload = (await response.json()) as RecentJobsResponse | { ok: false; error: string };
  if (!payload.ok) {
    throw new Error(payload.error);
  }
  return payload.jobs;
}

export async function cancelJob(jobId: string): Promise<void> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST"
  });
  const payload = (await response.json()) as { ok?: boolean; error?: string };
  if (!payload.ok) {
    throw new Error(payload.error ?? "Could not cancel job.");
  }
}

export async function retryJob(jobId: string): Promise<{ jobId: string }> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST"
  });
  const payload = (await response.json()) as { ok?: boolean; error?: string; jobId?: string };
  if (!payload.ok || !payload.jobId) {
    throw new Error(payload.error ?? "Could not retry job.");
  }
  return { jobId: payload.jobId };
}

export type JobArtifact = {
  id: string;
  kind: JobKind;
  artifactType: string;
  artifactPath: string;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export async function getJobArtifacts(jobId: string): Promise<JobArtifact[]> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/artifacts`, {
    method: "GET",
    cache: "no-store"
  });
  const payload = (await response.json()) as
    | { ok: true; artifacts: JobArtifact[] }
    | { ok: false; error: string };
  if (!payload.ok) {
    throw new Error(payload.error);
  }
  return payload.artifacts;
}
