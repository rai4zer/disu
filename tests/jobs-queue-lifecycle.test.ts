import assert from "node:assert/strict";
import test from "node:test";
import {
  computeRetryDelayMs,
  isWithinIdempotencyWindow,
  nextStageForTerminalStatus,
  shouldRequeueRunningJob
} from "../app/lib/jobs/lifecycle.ts";

test("retry delay increases with attempts and caps at 10s", () => {
  assert.equal(computeRetryDelayMs(0), 2000);
  assert.equal(computeRetryDelayMs(1), 2000);
  assert.equal(computeRetryDelayMs(2), 4000);
  assert.equal(computeRetryDelayMs(9), 10000);
});

test("recovery requeues stale running jobs when requeue-all is disabled", () => {
  const nowMs = Date.parse("2026-02-25T12:00:00.000Z");
  const staleMs = 120_000;
  assert.equal(
    shouldRequeueRunningJob({
      requeueAllRunning: false,
      startedAt: "2026-02-25T11:56:00.000Z",
      nowMs,
      staleMs
    }),
    true
  );
  assert.equal(
    shouldRequeueRunningJob({
      requeueAllRunning: false,
      startedAt: "2026-02-25T11:59:30.000Z",
      nowMs,
      staleMs
    }),
    false
  );
});

test("recovery requeues invalid timestamps and forced mode", () => {
  const nowMs = Date.parse("2026-02-25T12:00:00.000Z");
  assert.equal(
    shouldRequeueRunningJob({
      requeueAllRunning: false,
      startedAt: null,
      nowMs,
      staleMs: 120_000
    }),
    true
  );
  assert.equal(
    shouldRequeueRunningJob({
      requeueAllRunning: true,
      startedAt: "2026-02-25T11:59:59.000Z",
      nowMs,
      staleMs: 120_000
    }),
    true
  );
});

test("terminal statuses map to lifecycle stages", () => {
  assert.equal(nextStageForTerminalStatus("succeeded"), "done");
  assert.equal(nextStageForTerminalStatus("failed"), "failed");
});

test("idempotency replay window accepts fresh keys and rejects stale/invalid timestamps", () => {
  const nowMs = Date.parse("2026-03-02T10:00:00.000Z");
  assert.equal(
    isWithinIdempotencyWindow({
      createdAt: "2026-03-02T09:30:00.000Z",
      nowMs,
      windowHours: 2
    }),
    true
  );
  assert.equal(
    isWithinIdempotencyWindow({
      createdAt: "2026-03-01T22:30:00.000Z",
      nowMs,
      windowHours: 2
    }),
    false
  );
  assert.equal(
    isWithinIdempotencyWindow({
      createdAt: null,
      nowMs,
      windowHours: 2
    }),
    false
  );
});
