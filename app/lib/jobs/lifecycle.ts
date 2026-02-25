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
