import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

type DbUser = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  created_at?: string;
  updated_at?: string;
};

type DbJob = {
  id: string;
  user_id: string;
  kind: "quant" | "primer";
  status: "queued" | "running" | "succeeded" | "failed";
  stage: "queued" | "fetching" | "running" | "done" | "failed";
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  run_after: string;
};

const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "") ?? "";
const apiKey = process.env.SUPABASE_KEY ?? "";
const hasDbEnv = Boolean(baseUrl && apiKey);

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

test("jobs table enforces idempotency per user+kind", { skip: !hasDbEnv }, async () => {
  const uid = `usr_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const email = `${uid}@example.com`;
  const now = new Date().toISOString();
  const idempotencyKey = `it:${randomUUID()}`;

  const userInsert = await restRequest<DbUser[]>("users", {
    method: "POST",
    body: JSON.stringify([
      {
        id: uid,
        email,
        password_hash: "x".repeat(128),
        password_salt: "salt",
        created_at: now,
        updated_at: now
      }
    ])
  });
  assert.equal(userInsert.ok, true, `failed to create test user: ${JSON.stringify(userInsert.body)}`);

  const jobIdA = `job_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const insertA = await restRequest<DbJob[]>("jobs", {
    method: "POST",
    body: JSON.stringify([
      {
        id: jobIdA,
        user_id: uid,
        kind: "quant",
        status: "queued",
        stage: "queued",
        idempotency_key: idempotencyKey,
        payload: { ticker: "AAPL", retrain: false },
        result: null,
        error: null,
        error_code: null,
        attempts: 0,
        max_attempts: 2,
        run_after: now,
        started_at: null,
        finished_at: null,
        created_at: now,
        updated_at: now
      }
    ])
  });
  assert.equal(insertA.ok, true, `failed to insert first job: ${JSON.stringify(insertA.body)}`);

  const jobIdB = `job_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const insertB = await restRequest<unknown>("jobs", {
    method: "POST",
    body: JSON.stringify([
      {
        id: jobIdB,
        user_id: uid,
        kind: "quant",
        status: "queued",
        stage: "queued",
        idempotency_key: idempotencyKey,
        payload: { ticker: "AAPL", retrain: false },
        result: null,
        error: null,
        error_code: null,
        attempts: 0,
        max_attempts: 2,
        run_after: now,
        started_at: null,
        finished_at: null,
        created_at: now,
        updated_at: now
      }
    ])
  });
  assert.equal(insertB.ok, false, "duplicate idempotency insert should fail");
  assert.equal(insertB.status, 409);

  await restRequest<unknown>(`jobs?user_id=eq.${uid}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
  await restRequest<unknown>(`users?id=eq.${uid}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
});

test("job artifacts can be persisted for a finished job", { skip: !hasDbEnv }, async () => {
  const uid = `usr_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const email = `${uid}@example.com`;
  const now = new Date().toISOString();
  const jobId = `job_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const artifactId = `art_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const userInsert = await restRequest<DbUser[]>("users", {
    method: "POST",
    body: JSON.stringify([
      {
        id: uid,
        email,
        password_hash: "x".repeat(128),
        password_salt: "salt",
        created_at: now,
        updated_at: now
      }
    ])
  });
  assert.equal(userInsert.ok, true, `failed to create test user: ${JSON.stringify(userInsert.body)}`);

  const jobInsert = await restRequest<DbJob[]>("jobs", {
    method: "POST",
    body: JSON.stringify([
      {
        id: jobId,
        user_id: uid,
        kind: "primer",
        status: "succeeded",
        stage: "done",
        idempotency_key: null,
        payload: { ticker: "MSFT", llmProvider: "openai_compatible" },
        result: {},
        error: null,
        error_code: null,
        attempts: 1,
        max_attempts: 2,
        run_after: now,
        started_at: now,
        finished_at: now,
        created_at: now,
        updated_at: now
      }
    ])
  });
  assert.equal(jobInsert.ok, true, `failed to insert job: ${JSON.stringify(jobInsert.body)}`);

  const artifactInsert = await restRequest<unknown>("job_artifacts", {
    method: "POST",
    body: JSON.stringify([
      {
        id: artifactId,
        job_id: jobId,
        user_id: uid,
        kind: "primer",
        artifact_type: "primer_text",
        artifact_path: `job://${jobId}/primer/text`,
        content_hash: "abc123",
        metadata: { ticker: "MSFT" },
        created_at: now
      }
    ])
  });
  assert.equal(artifactInsert.ok, true, `failed to insert artifact: ${JSON.stringify(artifactInsert.body)}`);

  const artifactRead = await restRequest<Array<{ id: string }>>(
    `job_artifacts?job_id=eq.${jobId}&user_id=eq.${uid}&select=id&limit=1`
  );
  assert.equal(artifactRead.ok, true, `failed to read artifact rows: ${JSON.stringify(artifactRead.body)}`);
  assert.equal(Array.isArray(artifactRead.body), true);
  assert.equal((artifactRead.body ?? []).length, 1);

  await restRequest<unknown>(`jobs?user_id=eq.${uid}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
  await restRequest<unknown>(`users?id=eq.${uid}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
});
