import assert from "node:assert/strict";
import test from "node:test";

import { startFakeSupabase } from "./support/fake-supabase.ts";

/**
 * Cross-tenant isolation for every user-owned table (ROADMAP §2.4, risk R2).
 *
 * Handlers run with the Supabase service-role key, which bypasses RLS, so the
 * `user_id` filter on each query is the *entire* authorization boundary. These
 * tests drive the real store modules against an in-memory PostgREST stand-in and
 * assert the shape that matters: with user A's id in hand you cannot read,
 * mutate or delete a row belonging to user B — and, separately, that no request
 * ever leaves without the filter attached, so a future refactor cannot quietly
 * widen the scope while still returning the right rows by luck.
 */

const ALICE = "usr_alice";
const BOB = "usr_bob";

const NOW = "2026-08-25T09:00:00.000Z";

function seed() {
  return {
    broker_connections: [
      { id: "conn_alice", user_id: ALICE, broker: "avanza", status: "connected", auth_provider: "manual", data_scope: "positions_plus", external_account_id: "A", consent_expires_at: null, last_synced_at: null, error_code: null, created_at: NOW, updated_at: NOW },
      { id: "conn_bob", user_id: BOB, broker: "avanza", status: "connected", auth_provider: "manual", data_scope: "positions_plus", external_account_id: "B", consent_expires_at: null, last_synced_at: null, error_code: null, created_at: NOW, updated_at: NOW }
    ],
    positions: [
      { id: "pos_alice", user_id: ALICE, connection_id: "conn_alice", symbol: "ERIC-B.ST", isin: "SE1", name: "Ericsson", quantity: 10, avg_cost: 60, currency: "SEK", market_value: 700, as_of: NOW },
      { id: "pos_bob", user_id: BOB, connection_id: "conn_bob", symbol: "VOLV-B.ST", isin: "SE2", name: "Volvo", quantity: 5, avg_cost: 250, currency: "SEK", market_value: 1400, as_of: NOW }
    ],
    broker_connection_accounts: [
      { id: "acct_alice", user_id: ALICE, connection_id: "conn_alice", provider_account_id: "pa_alice", provider_account_name: "Alice ISK", account_type: "ISK", selected: true, created_at: NOW, updated_at: NOW },
      { id: "acct_bob", user_id: BOB, connection_id: "conn_bob", provider_account_id: "pa_bob", provider_account_name: "Bob ISK", account_type: "ISK", selected: true, created_at: NOW, updated_at: NOW }
    ],
    broker_connection_secrets: [
      { id: "secret_bob", user_id: BOB, connection_id: "conn_bob", provider: "tink", encrypted_access_token: "v1.aa.bb.cc", encrypted_refresh_token: null, token_expires_at: null, token_scope: null, created_at: NOW, updated_at: NOW }
    ],
    manual_positions: [
      { id: "mp_alice", user_id: ALICE, ticker: "AAPL", shares: 3, avg_cost: 100, account_type: "ISK", broker: null, currency: "USD", created_at: NOW, updated_at: NOW },
      { id: "mp_bob", user_id: BOB, ticker: "TSLA", shares: 7, avg_cost: 200, account_type: "AF", broker: null, currency: "USD", created_at: NOW, updated_at: NOW }
    ],
    jobs: [
      { id: "job_alice", user_id: ALICE, kind: "quant", status: "succeeded", stage: "done", idempotency_key: "k_alice", payload: { ticker: "ERIC-B.ST" }, result: null, error: null, error_code: null, attempts: 1, max_attempts: 2, queued_ms: 1, fetch_ms: 1, run_ms: 1, run_after: NOW, dismissed_at: null, started_at: NOW, finished_at: NOW, created_at: NOW, updated_at: NOW },
      { id: "job_bob", user_id: BOB, kind: "quant", status: "failed", stage: "failed", idempotency_key: "k_bob", payload: { ticker: "VOLV-B.ST" }, result: null, error: "boom", error_code: "runtime", attempts: 1, max_attempts: 2, queued_ms: 1, fetch_ms: 1, run_ms: 1, run_after: NOW, dismissed_at: null, started_at: NOW, finished_at: NOW, created_at: NOW, updated_at: NOW }
    ],
    job_artifacts: [
      { id: "art_alice", user_id: ALICE, job_id: "job_alice", kind: "quant", artifact_type: "quant_model", artifact_path: "a", content_hash: null, metadata: {}, created_at: NOW },
      { id: "art_bob", user_id: BOB, job_id: "job_bob", kind: "quant", artifact_type: "quant_model", artifact_path: "b", content_hash: null, metadata: {}, created_at: NOW }
    ],
    user_roles: [{ id: "role_bob", user_id: BOB, role: "admin", created_at: NOW }],
    events: []
  };
}

type Harness = Awaited<ReturnType<typeof startFakeSupabase>>;

async function withDb(run: (db: Harness) => Promise<void>): Promise<void> {
  const db = await startFakeSupabase(seed());
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = db.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  process.env.DISU_SESSION_SECRET ??= "test-session-secret-0123456789";
  process.env.BROKER_TOKEN_ENCRYPTION_KEY ??= "a".repeat(64);
  process.env.QUANT_PYTHON_BIN ??= "/bin/sh";
  process.env.PRIMER_PYTHON_BIN ??= "/bin/sh";

  try {
    await run(db);
  } finally {
    await db.close();
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
}

/**
 * Every request the app issued against a user-owned table must have carried a
 * `user_id` filter (reads/writes) or a `user_id` column (inserts). Anything the
 * worker does on purpose goes through systemRequest() and is not exercised here.
 */
function assertEveryRequestWasScoped(db: Harness, userId: string): void {
  for (const request of db.requests) {
    if (request.method === "POST") {
      const rows = Array.isArray(request.body) ? request.body : [request.body];
      for (const row of rows) {
        assert.equal(
          (row as Record<string, unknown>).user_id,
          userId,
          `${request.method} ${request.table} inserted a row without the caller's user_id`
        );
      }
      continue;
    }
    assert.equal(
      request.query.user_id,
      `eq.${userId}`,
      `${request.method} ${request.table} was issued without a user_id filter: ${JSON.stringify(request.query)}`
    );
  }
}

test("broker connections: Alice cannot read, sync-state or delete Bob's connection", async () => {
  await withDb(async (db) => {
    const store = await import("@/app/lib/brokers/store");

    assert.equal(await store.getConnection(ALICE, "conn_bob"), null);
    assert.deepEqual((await store.listConnections(ALICE)).map((c) => c.id), ["conn_alice"]);

    // A delete aimed at someone else's id must report "not found" and change nothing.
    assert.equal(await store.deleteConnection(ALICE, "conn_bob"), false);
    assert.ok(db.rowsIn("broker_connections").some((row) => row.id === "conn_bob"));

    await assert.rejects(
      () => store.completeConnection(ALICE, "conn_bob", { externalAccountId: "hijacked" }),
      /Connection not found/
    );
    assert.equal(
      db.rowsIn("broker_connections").find((row) => row.id === "conn_bob")?.external_account_id,
      "B"
    );

    await assert.rejects(() => store.syncConnection(ALICE, "conn_bob"), /Connection not found/);
    await assert.rejects(
      () => store.saveConnectionAccountSelection(ALICE, "conn_bob", { selectedAccountIds: ["pa_bob"], dataScope: "positions_plus" }),
      /Connection not found/
    );

    assertEveryRequestWasScoped(db, ALICE);
  });
});

test("positions: Alice sees only her own holdings", async () => {
  await withDb(async (db) => {
    const store = await import("@/app/lib/brokers/store");

    const positions = await store.listPositions(ALICE);
    assert.deepEqual(positions.map((position) => position.id), ["pos_alice"]);

    assertEveryRequestWasScoped(db, ALICE);
  });
});

test("broker accounts: Alice cannot enumerate Bob's accounts", async () => {
  await withDb(async (db) => {
    const store = await import("@/app/lib/brokers/store");

    assert.deepEqual(await store.listConnectionAccounts(ALICE, "conn_bob"), []);

    assertEveryRequestWasScoped(db, ALICE);
  });
});

test("broker secrets: Alice cannot read Bob's stored broker token", async () => {
  await withDb(async (db) => {
    const vault = await import("@/app/lib/brokers/tokenVault");

    // The row exists and is Bob's; scoping — not decryption — must be what stops us.
    assert.ok(db.rowsIn("broker_connection_secrets").some((row) => row.id === "secret_bob"));
    assert.equal(await vault.getConnectionSecret(ALICE, "conn_bob"), null);

    assertEveryRequestWasScoped(db, ALICE);
  });
});

test("manual positions: Alice cannot read, edit or delete Bob's position", async () => {
  await withDb(async (db) => {
    const store = await import("@/app/lib/portfolio/manual-store");

    assert.deepEqual((await store.listManualPositions(ALICE)).map((p) => p.id), ["mp_alice"]);
    assert.equal(await store.getManualPositionById(ALICE, "mp_bob"), null);

    assert.equal(await store.updateManualPosition(ALICE, "mp_bob", { shares: 9999 }), null);
    assert.equal(db.rowsIn("manual_positions").find((row) => row.id === "mp_bob")?.shares, 7);

    assert.equal(await store.deleteManualPosition(ALICE, "mp_bob"), false);
    assert.ok(db.rowsIn("manual_positions").some((row) => row.id === "mp_bob"));

    assertEveryRequestWasScoped(db, ALICE);
  });
});

test("jobs: Alice cannot read or mutate Bob's job", async () => {
  await withDb(async (db) => {
    const store = await import("@/app/lib/jobs/store");

    assert.equal(await store.getJobForUser("job_bob", ALICE), null);
    assert.deepEqual((await store.listRecentJobsForUser({ userId: ALICE, limit: 50, statuses: ["queued", "running", "succeeded", "failed"] })).map((j) => j.id), ["job_alice"]);

    // The route-facing update refuses a job that is not the caller's, so a
    // guessed id cannot be retried, cancelled or dismissed out from under Bob.
    assert.equal(await store.updateJobForUser("job_bob", ALICE, { status: "queued" }), null);
    assert.equal(db.rowsIn("jobs").find((row) => row.id === "job_bob")?.status, "failed");

    assert.equal(await store.findJobForUserByIdempotency({ userId: ALICE, kind: "quant", idempotencyKey: "k_bob" }), null);
    assert.equal(await store.findActiveJobForUserKindTicker({ userId: ALICE, kind: "quant", ticker: "VOLV-B.ST" }), null);

    assertEveryRequestWasScoped(db, ALICE);
  });
});

test("job artifacts: Alice cannot list artifacts of Bob's job", async () => {
  await withDb(async (db) => {
    const store = await import("@/app/lib/jobs/store");

    assert.deepEqual(await store.listJobArtifactsForUser({ userId: ALICE, jobId: "job_bob" }), []);
    assert.deepEqual((await store.listJobArtifactsForUser({ userId: ALICE, jobId: "job_alice" })).map((a) => a.id), ["art_alice"]);

    assertEveryRequestWasScoped(db, ALICE);
  });
});

test("roles: Bob's admin grant does not make Alice an admin", async () => {
  await withDb(async (db) => {
    const access = await import("@/app/lib/admin/access");

    assert.equal(await access.isAdminUser(BOB), true);
    assert.equal(await access.isAdminUser(ALICE), false);

    // Two different callers here, so check the filter per request rather than
    // against a single expected id.
    assert.deepEqual(
      db.requests.map((request) => request.query.user_id),
      [`eq.${BOB}`, `eq.${ALICE}`]
    );
  });
});

test("writes are stamped with the caller's id, not one supplied by the caller", async () => {
  await withDb(async (db) => {
    const jobs = await import("@/app/lib/jobs/store");
    const events = await import("@/app/lib/db/events");
    const manual = await import("@/app/lib/portfolio/manual-store");

    await jobs.enqueueJob({ userId: ALICE, kind: "quant", payload: { ticker: "ERIC-B.ST", retrain: false } });
    await events.recordEvent({ userId: ALICE, action: "quant_run", status: "success" });
    await manual.createManualPosition(ALICE, { ticker: "NVDA", shares: 1, currency: "USD" });

    for (const table of ["jobs", "events", "manual_positions"]) {
      const foreign = db.rowsIn(table).filter((row) => row.user_id !== ALICE && row.user_id !== BOB);
      assert.deepEqual(foreign, [], `${table} gained a row with an unexpected owner`);
    }
    assert.ok(db.rowsIn("events").every((row) => row.user_id === ALICE));

    assertEveryRequestWasScoped(db, ALICE);
  });
});

test("the helper refuses the ways a caller could widen its own scope", async () => {
  await withDb(async (db) => {
    const { userScoped, systemRequest } = await import("@/app/lib/db/user-scope");

    // Supplying your own user_id filter is never a mistake worth merging — the
    // only reason to do it is to look somewhere you should not.
    await assert.rejects(
      () => userScoped(ALICE, "jobs", { query: { user_id: `eq.${BOB}` } }),
      /received a user_id filter/
    );

    // An empty id would render as `user_id=eq.` — a filter that silently matches
    // nothing, turning a broken session into an empty list instead of an error.
    await assert.rejects(() => userScoped("", "jobs", {}), /without a user id/);
    await assert.rejects(() => userScoped("   ", "jobs", {}), /without a user id/);

    // An insert may restate its own owner, but not someone else's.
    await assert.rejects(
      () =>
        userScoped(ALICE, "manual_positions", {
          method: "POST",
          body: { id: "mp_forged", user_id: BOB, ticker: "MSFT", shares: 1, currency: "USD" }
        }),
      /declares user_id/
    );
    assert.equal(db.rowsIn("manual_positions").some((row) => row.id === "mp_forged"), false);

    // The cross-tenant escape hatch has to say why it is exempt.
    await assert.rejects(() => systemRequest("jobs", { reason: "  " }), /requires a reason/);
  });
});

test("systemRequest reaches every tenant, which is the point of it existing", async () => {
  await withDb(async () => {
    const store = await import("@/app/lib/jobs/store");

    // The worker has no session: it must see both users' rows or the queue stalls.
    const pruned = await store.cleanupOldTerminalJobs("2099-01-01T00:00:00.000Z");
    assert.equal(pruned, 2, "retention pruning must span tenants");
  });
});
