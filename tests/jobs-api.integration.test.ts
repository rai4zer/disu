import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";

type DbUser = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
};

type DbJob = {
  id: string;
  user_id: string;
  kind: "quant" | "primer";
  status: "queued" | "running" | "succeeded" | "failed";
  stage: "queued" | "fetching" | "running" | "done" | "failed";
  payload: Record<string, unknown>;
  run_after: string;
};

const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "") ?? "";
const apiKey = process.env.SUPABASE_KEY ?? "";
const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "") ?? "";
const sessionSecret = process.env.DISU_SESSION_SECRET ?? "";
const SESSION_COOKIE_NAME = "disu_session";
const hasApiTestEnv = Boolean(
  baseUrl &&
    apiKey &&
    appBaseUrl &&
    process.env.DISU_SESSION_SECRET &&
    process.env.QUANT_PYTHON_BIN &&
    process.env.PRIMER_PYTHON_BIN
);

async function restRequest<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T | null }> {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Prefer: "return=representation",
      ...(init?.headers ?? {})
    }
  });
  const body = (await response.json().catch(() => null)) as T | null;
  return { ok: response.ok, status: response.status, body };
}

async function cleanupUser(userId: string): Promise<void> {
  await restRequest<unknown>(`job_artifacts?user_id=eq.${userId}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
  await restRequest<unknown>(`jobs?user_id=eq.${userId}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
  await restRequest<unknown>(`users?id=eq.${userId}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
}

function createSessionCookie(userId: string, email: string): string {
  const payload = {
    userId,
    email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const signature = createHmac("sha256", sessionSecret).update(payloadB64).digest("base64url");
  return `${SESSION_COOKIE_NAME}=${payloadB64}.${signature}`;
}

test("jobs API routes expose status/artifacts and support retry/cancel", { skip: !hasApiTestEnv }, async () => {
  const userId = `usr_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const email = `${userId}@example.com`;
  const now = new Date().toISOString();

  const userInsert = await restRequest<DbUser[]>("users", {
    method: "POST",
    body: JSON.stringify([
      {
        id: userId,
        email,
        password_hash: "x".repeat(128),
        password_salt: "salt"
      }
    ])
  });
  assert.equal(userInsert.ok, true, `failed to insert user: ${JSON.stringify(userInsert.body)}`);

  const failedJobId = `job_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const queuedJobId = `job_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

  const jobsInsert = await restRequest<DbJob[]>("jobs", {
    method: "POST",
    body: JSON.stringify([
      {
        id: failedJobId,
        user_id: userId,
        kind: "quant",
        status: "failed",
        stage: "failed",
        idempotency_key: null,
        payload: { ticker: "AAPL", retrain: false },
        result: null,
        error: "forced failure",
        error_code: "runtime",
        attempts: 1,
        max_attempts: 2,
        queued_ms: 10,
        fetch_ms: 20,
        run_ms: 30,
        run_after: now,
        started_at: now,
        finished_at: now,
        created_at: now,
        updated_at: now
      },
      {
        id: queuedJobId,
        user_id: userId,
        kind: "primer",
        status: "queued",
        stage: "queued",
        idempotency_key: null,
        payload: { ticker: "MSFT", llmProvider: "openai_compatible" },
        result: null,
        error: null,
        error_code: null,
        attempts: 0,
        max_attempts: 2,
        queued_ms: null,
        fetch_ms: null,
        run_ms: null,
        run_after: now,
        started_at: null,
        finished_at: null,
        created_at: now,
        updated_at: now
      }
    ])
  });
  assert.equal(jobsInsert.ok, true, `failed to insert jobs: ${JSON.stringify(jobsInsert.body)}`);

  const artifactInsert = await restRequest<unknown>("job_artifacts", {
    method: "POST",
    body: JSON.stringify([
      {
        id: `art_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        job_id: failedJobId,
        user_id: userId,
        kind: "quant",
        artifact_type: "quant_forecast_snapshot",
        artifact_path: `job://${failedJobId}/quant/forecast`,
        content_hash: "abc123",
        metadata: { ticker: "AAPL" },
        created_at: now
      }
    ])
  });
  assert.equal(artifactInsert.ok, true, `failed to insert artifact: ${JSON.stringify(artifactInsert.body)}`);

  const cookie = createSessionCookie(userId, email);
  const headers = { cookie };

  const statusRes = await fetch(`${appBaseUrl}/api/jobs/${failedJobId}`, { headers });
  const statusBody = (await statusRes.json()) as { ok: boolean; job?: { id: string; status: string } };
  assert.equal(statusRes.status, 200);
  assert.equal(statusBody.ok, true);
  assert.equal(statusBody.job?.id, failedJobId);

  const artifactsRes = await fetch(`${appBaseUrl}/api/jobs/${failedJobId}/artifacts`, { headers });
  const artifactsBody = (await artifactsRes.json()) as { ok: boolean; artifacts?: Array<{ artifactType: string }> };
  assert.equal(artifactsRes.status, 200);
  assert.equal(artifactsBody.ok, true);
  assert.equal((artifactsBody.artifacts ?? []).length >= 1, true);

  const retryRes = await fetch(`${appBaseUrl}/api/jobs/${failedJobId}/retry`, {
    method: "POST",
    headers
  });
  const retryBody = (await retryRes.json()) as { ok: boolean; status?: string };
  assert.equal(retryRes.status, 200);
  assert.equal(retryBody.ok, true);
  assert.equal(retryBody.status, "queued");

  const cancelRes = await fetch(`${appBaseUrl}/api/jobs/${queuedJobId}/cancel`, {
    method: "POST",
    headers
  });
  const cancelBody = (await cancelRes.json()) as { ok: boolean; status?: string };
  assert.equal(cancelRes.status, 200);
  assert.equal(cancelBody.ok, true);
  assert.equal(cancelBody.status, "failed");

  await cleanupUser(userId);
});
