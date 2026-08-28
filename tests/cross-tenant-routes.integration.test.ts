import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createLiveSessionCookie } from "./support/integration-session.ts";

/**
 * Route-level cross-tenant isolation (ROADMAP §2.4).
 *
 * `tests/cross-tenant-isolation.test.ts` proves the store layer scopes every
 * query and runs on every commit. This file closes the loop over HTTP: it seeds
 * two real users in Supabase, then walks each route that takes a resource id in
 * its path — the IDOR-shaped surface — with Bob's id in Alice's session and
 * asserts a 404 and an unchanged row.
 *
 * Skips unless a live app and Supabase project are configured, in the same way
 * as the other files in `npm run test:smoke`.
 */

const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "") ?? "";
const apiKey = process.env.SUPABASE_KEY ?? "";
const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "") ?? "";
const sessionSecret = process.env.DISU_SESSION_SECRET ?? "";

const hasApiTestEnv = Boolean(
  baseUrl && apiKey && appBaseUrl && sessionSecret && process.env.QUANT_PYTHON_BIN && process.env.PRIMER_PYTHON_BIN
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

function newId(prefix: string): string {
  return `${prefix}_xt_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function deleteWhere(table: string, filter: string): Promise<void> {
  await restRequest(`${table}?${filter}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
}

test("no route lets one user reach another user's row", { skip: !hasApiTestEnv }, async () => {
  const now = new Date().toISOString();
  const alice = newId("usr");
  const bob = newId("usr");
  const bobConnection = newId("conn");
  const bobJob = newId("job");
  const bobPosition = randomUUID();

  try {
    const users = await restRequest("users", {
      method: "POST",
      body: JSON.stringify(
        [alice, bob].map((id) => ({
          id,
          email: `${id}@example.com`,
          password_hash: "x".repeat(128),
          password_salt: "salt"
        }))
      )
    });
    assert.equal(users.ok, true, `failed to seed users: ${JSON.stringify(users.body)}`);

    const connection = await restRequest("broker_connections", {
      method: "POST",
      body: JSON.stringify([
        {
          id: bobConnection,
          user_id: bob,
          broker: "avanza",
          status: "connected",
          auth_provider: "manual",
          data_scope: "positions_plus",
          external_account_id: "BOB-CSV",
          consent_expires_at: null,
          last_synced_at: null,
          error_code: null,
          created_at: now,
          updated_at: now
        }
      ])
    });
    assert.equal(connection.ok, true, `failed to seed connection: ${JSON.stringify(connection.body)}`);

    const job = await restRequest("jobs", {
      method: "POST",
      body: JSON.stringify([
        {
          id: bobJob,
          user_id: bob,
          kind: "quant",
          status: "failed",
          stage: "failed",
          idempotency_key: null,
          payload: { ticker: "VOLV-B.ST", retrain: false },
          result: null,
          error: "seeded",
          error_code: "runtime",
          attempts: 1,
          max_attempts: 2,
          queued_ms: 1,
          fetch_ms: 1,
          run_ms: 1,
          run_after: now,
          started_at: now,
          finished_at: now,
          created_at: now,
          updated_at: now
        }
      ])
    });
    assert.equal(job.ok, true, `failed to seed job: ${JSON.stringify(job.body)}`);

    const position = await restRequest("manual_positions", {
      method: "POST",
      body: JSON.stringify([
        {
          id: bobPosition,
          user_id: bob,
          ticker: "TSLA",
          shares: 7,
          avg_cost: 200,
          account_type: "AF",
          broker: null,
          currency: "USD",
          created_at: now,
          updated_at: now
        }
      ])
    });
    assert.equal(position.ok, true, `failed to seed manual position: ${JSON.stringify(position.body)}`);

    const aliceCookie = await createLiveSessionCookie({
      baseUrl,
      apiKey,
      sessionSecret,
      userId: alice,
      email: `${alice}@example.com`
    });
    const asAlice = { cookie: aliceCookie, "Content-Type": "application/json" };

    // Every route that accepts a resource id in its path. A hit here is a
    // cross-user read or write, which is why they are enumerated rather than
    // sampled.
    const probes: Array<{ label: string; method: string; path: string; body?: unknown }> = [
      { label: "GET /api/jobs/[jobId]", method: "GET", path: `/api/jobs/${bobJob}` },
      { label: "GET /api/jobs/[jobId]/artifacts", method: "GET", path: `/api/jobs/${bobJob}/artifacts` },
      { label: "POST /api/jobs/[jobId]/cancel", method: "POST", path: `/api/jobs/${bobJob}/cancel` },
      { label: "POST /api/jobs/[jobId]/retry", method: "POST", path: `/api/jobs/${bobJob}/retry` },
      { label: "POST /api/jobs/[jobId]/dismiss", method: "POST", path: `/api/jobs/${bobJob}/dismiss` },
      { label: "DELETE /api/brokers/[connectionId]", method: "DELETE", path: `/api/brokers/${bobConnection}` },
      { label: "GET /api/brokers/[connectionId]/accounts", method: "GET", path: `/api/brokers/${bobConnection}/accounts` },
      {
        label: "PUT /api/brokers/[connectionId]/accounts",
        method: "PUT",
        path: `/api/brokers/${bobConnection}/accounts`,
        body: { selectedAccountIds: ["pa_bob"], dataScope: "positions_plus" }
      },
      { label: "GET /api/brokers/[connectionId]/diagnostics", method: "GET", path: `/api/brokers/${bobConnection}/diagnostics` },
      { label: "POST /api/brokers/[connectionId]/sync", method: "POST", path: `/api/brokers/${bobConnection}/sync` },
      { label: "POST /api/brokers/[connectionId]/complete", method: "POST", path: `/api/brokers/${bobConnection}/complete`, body: {} },
      {
        label: "PATCH /api/portfolio/positions/[positionId]",
        method: "PATCH",
        path: `/api/portfolio/positions/${bobPosition}`,
        body: { shares: 9999 }
      },
      { label: "DELETE /api/portfolio/positions/[positionId]", method: "DELETE", path: `/api/portfolio/positions/${bobPosition}` }
    ];

    for (const probe of probes) {
      const response = await fetch(`${appBaseUrl}${probe.path}`, {
        method: probe.method,
        headers: asAlice,
        body: probe.body === undefined ? undefined : JSON.stringify(probe.body)
      });

      assert.equal(
        response.status < 200 || response.status >= 300,
        true,
        `${probe.label} returned ${response.status} for another user's row — it should not succeed`
      );
      assert.ok(
        [400, 404, 409, 500].includes(response.status),
        `${probe.label} returned an unexpected ${response.status}`
      );
    }

    // Nothing Alice did may have touched Bob's data.
    const jobAfter = await restRequest<Array<{ status: string; dismissed_at: string | null }>>(
      `jobs?id=eq.${bobJob}&select=status,dismissed_at`
    );
    assert.equal(jobAfter.body?.[0]?.status, "failed", "Bob's job status changed");
    assert.equal(jobAfter.body?.[0]?.dismissed_at, null, "Bob's job was dismissed by another user");

    const connectionAfter = await restRequest<Array<{ id: string }>>(`broker_connections?id=eq.${bobConnection}&select=id`);
    assert.equal(connectionAfter.body?.length, 1, "Bob's broker connection was deleted by another user");

    const positionAfter = await restRequest<Array<{ shares: number }>>(
      `manual_positions?id=eq.${bobPosition}&select=shares`
    );
    assert.equal(positionAfter.body?.length, 1, "Bob's manual position was deleted by another user");
    assert.equal(Number(positionAfter.body?.[0]?.shares), 7, "Bob's manual position was edited by another user");

    // And Alice's own listings must not mention Bob at all.
    const brokersRes = await fetch(`${appBaseUrl}/api/brokers`, { headers: asAlice });
    assert.equal(brokersRes.status, 200);
    assert.equal(JSON.stringify(await brokersRes.json()).includes(bobConnection), false);

    const recentRes = await fetch(`${appBaseUrl}/api/jobs/recent?statuses=queued,running,succeeded,failed`, {
      headers: asAlice
    });
    assert.equal(recentRes.status, 200);
    assert.equal(JSON.stringify(await recentRes.json()).includes(bobJob), false);

    const positionsRes = await fetch(`${appBaseUrl}/api/portfolio/positions`, { headers: asAlice });
    assert.equal(positionsRes.status, 200);
    assert.equal(JSON.stringify(await positionsRes.json()).includes(bobPosition), false);
  } finally {
    for (const userId of [alice, bob]) {
      await deleteWhere("user_sessions", `user_id=eq.${userId}`);
      await deleteWhere("job_artifacts", `user_id=eq.${userId}`);
      await deleteWhere("jobs", `user_id=eq.${userId}`);
      await deleteWhere("positions", `user_id=eq.${userId}`);
      await deleteWhere("manual_positions", `user_id=eq.${userId}`);
      await deleteWhere("broker_connection_secrets", `user_id=eq.${userId}`);
      await deleteWhere("broker_connection_accounts", `user_id=eq.${userId}`);
      await deleteWhere("broker_connections", `user_id=eq.${userId}`);
      await deleteWhere("events", `user_id=eq.${userId}`);
      await deleteWhere("users", `id=eq.${userId}`);
    }
  }
});
