export function shouldRequeueRunningJob(input: {
  requeueAllRunning: boolean;
  startedAt: string | null;
  nowMs: number;
  staleMs: number;
}): boolean {
  if (input.requeueAllRunning) {
    return true;
  }
  const startedTs = Date.parse(input.startedAt ?? "");
  if (!Number.isFinite(startedTs)) {
    return true;
  }
  return input.nowMs - startedTs >= input.staleMs;
}

export function computeRetryDelayMs(attempts: number): number {
  return Math.min(10_000, 2_000 * Math.max(1, attempts));
}

export function nextStageForTerminalStatus(status: "succeeded" | "failed"): "done" | "failed" {
  return status === "succeeded" ? "done" : "failed";
}

export function isWithinIdempotencyWindow(input: {
  createdAt: string | null | undefined;
  nowMs: number;
  windowHours: number;
}): boolean {
  const createdTs = Date.parse(input.createdAt ?? "");
  if (!Number.isFinite(createdTs)) {
    return false;
  }
  const maxAgeMs = Math.max(0, input.windowHours) * 60 * 60 * 1000;
  return input.nowMs - createdTs <= maxAgeMs;
}
