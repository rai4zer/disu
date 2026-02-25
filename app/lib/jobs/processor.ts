import { recordEvent } from "@/app/lib/db/events";
import { deriveArtifactsFromResult } from "@/app/lib/jobs/artifacts";
import { computeRetryDelayMs, nextStageForTerminalStatus, shouldRequeueRunningJob } from "@/app/lib/jobs/lifecycle";
import {
  cleanupOldJobArtifacts,
  cleanupOldTerminalJobs,
  getJobById,
  insertJobArtifacts,
  listQueuedJobs,
  listRunningJobs,
  updateJob
} from "@/app/lib/jobs/store";
import type { PrimerJobPayload, QuantJobPayload } from "@/app/lib/jobs/types";
import { executeQuantJob } from "@/app/lib/quant/executor";
import { executePrimerJob } from "@/app/lib/primers/executor";

const activeJobs = new Set<string>();
const scheduledJobs = new Set<string>();
const runningJobAbortControllers = new Map<string, AbortController>();
let workerInitialized = false;

function classifyError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("cancelled")) return "cancelled_by_user";
  if (normalized.includes("timed out")) return "timeout";
  if (normalized.includes("no output") || normalized.includes("non-json")) return "bridge_output";
  if (normalized.includes("not found")) return "missing_resource";
  if (normalized.includes("unauthorized") || normalized.includes("forbidden")) return "auth";
  if (normalized.includes("network") || normalized.includes("fetch")) return "network";
  return "runtime";
}

export function scheduleJobProcessing(jobId: string): void {
  if (activeJobs.has(jobId) || scheduledJobs.has(jobId)) {
    return;
  }

  scheduledJobs.add(jobId);
  setTimeout(() => {
    scheduledJobs.delete(jobId);
    void processJob(jobId);
  }, 0);
}

export function initJobWorker(): void {
  if (workerInitialized) {
    return;
  }
  workerInitialized = true;
  setTimeout(() => {
    void recoverOrphanJobs();
  }, 0);
  setTimeout(() => {
    void cleanupOldJobData();
  }, 2_000);
  setInterval(() => {
    void cleanupOldJobData();
  }, 6 * 60 * 60 * 1000);
}

export function cancelRunningJob(jobId: string): boolean {
  const controller = runningJobAbortControllers.get(jobId);
  if (!controller) {
    return false;
  }
  controller.abort("cancelled_by_user");
  return true;
}

async function recoverOrphanJobs(): Promise<void> {
  const now = Date.now();
  const requeueAllRunning = process.env.JOB_RECOVERY_REQUEUE_ALL_RUNNING !== "0";
  const staleMsRaw = Number(process.env.JOB_RECOVERY_RUNNING_STALE_MS ?? "120000");
  const staleMs = Number.isFinite(staleMsRaw) && staleMsRaw > 0 ? staleMsRaw : 120_000;

  const [queuedJobs, runningJobs] = await Promise.all([listQueuedJobs(150), listRunningJobs(150)]);

  for (const job of queuedJobs) {
    const runAfterTs = Date.parse(job.run_after);
    if (!Number.isFinite(runAfterTs) || runAfterTs <= now) {
      scheduleJobProcessing(job.id);
    }
  }

  for (const job of runningJobs) {
    const shouldRequeue = shouldRequeueRunningJob({
      requeueAllRunning,
      startedAt: job.started_at,
      nowMs: now,
      staleMs
    });
    if (!shouldRequeue) {
      continue;
    }

    await updateJob(job.id, {
      status: "queued",
      stage: "queued",
      error: "Recovered after restart",
      error_code: "worker_recovery",
      run_after: new Date().toISOString(),
      started_at: null
    });
    scheduleJobProcessing(job.id);
  }
}

async function processJob(jobId: string): Promise<void> {
  if (activeJobs.has(jobId)) {
    return;
  }

  activeJobs.add(jobId);
  const startedAt = Date.now();
  const abortController = new AbortController();
  runningJobAbortControllers.set(jobId, abortController);

  try {
    const job = await getJobById(jobId);
    if (!job || (job.status !== "queued" && job.status !== "running")) {
      return;
    }

    const stageFetchStart = Date.now();
    const createdTs = Date.parse(job.created_at ?? "");
    const queuedMs = Number.isFinite(createdTs) ? Math.max(0, stageFetchStart - createdTs) : null;
    const nextAttempts = (job.attempts ?? 0) + 1;
    await updateJob(job.id, {
      status: "running",
      stage: "fetching",
      attempts: nextAttempts,
      queued_ms: queuedMs,
      fetch_ms: null,
      run_ms: null,
      started_at: new Date().toISOString(),
      error: null,
      error_code: null
    });

    let result: unknown;
    const runStart = Date.now();
    await updateJob(job.id, { stage: "running", fetch_ms: Math.max(0, runStart - stageFetchStart) });
    if (job.kind === "quant") {
      const payload = job.payload as QuantJobPayload;
      result = await executeQuantJob({ ...payload, signal: abortController.signal });
    } else {
      const payload = job.payload as PrimerJobPayload;
      result = await executePrimerJob({ ...payload, signal: abortController.signal });
    }

    const resultAsObj = result as { ok?: boolean; error?: string };
    if (resultAsObj.ok === false) {
      throw new Error(resultAsObj.error ?? "Job failed");
    }

    const latestJob = await getJobById(job.id);
    if (!latestJob || latestJob.status !== "running") {
      return;
    }

    await updateJob(job.id, {
      status: "succeeded",
      stage: nextStageForTerminalStatus("succeeded"),
      result,
      error: null,
      error_code: null,
      run_ms: Math.max(0, Date.now() - runStart),
      finished_at: new Date().toISOString()
    });

    const artifacts = deriveArtifactsFromResult({
      jobId: job.id,
      userId: job.user_id,
      kind: job.kind,
      result
    });
    if (artifacts.length > 0) {
      await insertJobArtifacts(artifacts);
    }

    void recordEvent({
      userId: job.user_id,
      action: job.kind === "quant" ? "quant_run" : "primer_run",
      status: "success",
      durationMs: Date.now() - startedAt,
      metadata: { jobId: job.id, attempts: nextAttempts }
    }).catch(() => {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown job failure";
    const job = await getJobById(jobId);

    if (!job) {
      return;
    }

    if (job.status === "failed" && job.error_code === "cancelled_by_user") {
      return;
    }

    const canRetry = job.attempts < job.max_attempts;
    if (canRetry) {
      const delayMs = computeRetryDelayMs(job.attempts);
      const runAfter = new Date(Date.now() + delayMs).toISOString();
      await updateJob(job.id, {
        status: "queued",
        stage: "queued",
        error: message,
        error_code: classifyError(message),
        fetch_ms: null,
        run_ms: null,
        run_after: runAfter
      });
      setTimeout(() => {
        void processJob(job.id);
      }, delayMs);
      return;
    }

    await updateJob(job.id, {
      status: "failed",
      stage: nextStageForTerminalStatus("failed"),
      error: message,
      error_code: classifyError(message),
      run_ms: job.run_ms ?? null,
      finished_at: new Date().toISOString()
    });

    void recordEvent({
      userId: job.user_id,
      action: job.kind === "quant" ? "quant_run" : "primer_run",
      status: "failure",
      durationMs: Date.now() - startedAt,
      metadata: { jobId: job.id, error: message, attempts: job.attempts }
    }).catch(() => {});
  } finally {
    runningJobAbortControllers.delete(jobId);
    activeJobs.delete(jobId);
  }
}

async function cleanupOldJobData(): Promise<void> {
  const jobsRetentionDaysRaw = Number(process.env.JOB_RETENTION_DAYS ?? "30");
  const artifactsRetentionDaysRaw = Number(process.env.JOB_ARTIFACT_RETENTION_DAYS ?? String(jobsRetentionDaysRaw));

  const jobsRetentionDays = Number.isFinite(jobsRetentionDaysRaw) && jobsRetentionDaysRaw > 0 ? jobsRetentionDaysRaw : 30;
  const artifactsRetentionDays =
    Number.isFinite(artifactsRetentionDaysRaw) && artifactsRetentionDaysRaw > 0 ? artifactsRetentionDaysRaw : jobsRetentionDays;

  const now = Date.now();
  const jobsCutoffIso = new Date(now - jobsRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  const artifactsCutoffIso = new Date(now - artifactsRetentionDays * 24 * 60 * 60 * 1000).toISOString();

  await Promise.all([cleanupOldJobArtifacts(artifactsCutoffIso), cleanupOldTerminalJobs(jobsCutoffIso)]);
}
