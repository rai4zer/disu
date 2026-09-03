import assert from "node:assert/strict";
import test from "node:test";

import { startFakeSupabase, type FakeSupabase } from "./support/fake-supabase.ts";

/**
 * GDPR export and erasure (ROADMAP §2.2).
 *
 * The properties that matter are not "the function ran" but:
 *   - erasure is *exhaustive* — nothing linked to the person survives;
 *   - erasure is *bounded* — it stops at their own rows and never touches Bob's;
 *   - public content is anonymised rather than deleted out from under the people
 *     replying to it;
 *   - a foreign key that would refuse the delete is reported, not blundered into;
 *   - the export hands over data, never credentials.
 */

const ALICE = "usr_alice";
const BOB = "usr_bob";
const NOW = "2026-08-25T09:00:00.000Z";

function seed() {
  const both = (idPrefix: string, extra: Record<string, unknown> = {}) => [
    { id: `${idPrefix}_alice`, user_id: ALICE, created_at: NOW, ...extra },
    { id: `${idPrefix}_bob`, user_id: BOB, created_at: NOW, ...extra }
  ];

  return {
    users: [
      { id: ALICE, email: "alice@example.se", password_hash: "hash-alice", password_salt: "salt", google_sub: null, created_at: NOW },
      { id: BOB, email: "bob@example.se", password_hash: "hash-bob", password_salt: "salt", google_sub: null, created_at: NOW }
    ],
    broker_connections: both("conn", { broker: "avanza", status: "connected" }),
    broker_connection_accounts: both("acct", { connection_id: "conn_alice" }),
    broker_connection_secrets: [
      { id: "secret_alice", user_id: ALICE, connection_id: "conn_alice", provider: "tink", encrypted_access_token: "v1.SECRET.MATERIAL", encrypted_refresh_token: "v1.MORE.SECRET", token_expires_at: null, token_scope: "accounts", created_at: NOW, updated_at: NOW },
      { id: "secret_bob", user_id: BOB, connection_id: "conn_bob", provider: "tink", encrypted_access_token: "v1.BOB.SECRET", encrypted_refresh_token: null, token_expires_at: null, token_scope: null, created_at: NOW, updated_at: NOW }
    ],
    positions: both("pos", { symbol: "ERIC-B.ST", quantity: 10 }),
    manual_positions: both("mp", { ticker: "AAPL", shares: 3, currency: "USD" }),
    // Written out rather than built with both(): this table dates rows by
    // `captured_at`, not `created_at`, and the seed should look like the schema.
    portfolio_snapshots: [
      { id: "snap_alice", user_id: ALICE, snapshot_date: "2026-08-26", captured_at: NOW, currency: "SEK", total_value: 700, cost_basis: 600, costed_value: 700, position_count: 1, valued_position_count: 1 },
      { id: "snap_bob", user_id: BOB, snapshot_date: "2026-08-26", captured_at: NOW, currency: "SEK", total_value: 1400, cost_basis: 1250, costed_value: 1400, position_count: 1, valued_position_count: 1 }
    ],
    jobs: both("job", { kind: "quant", status: "succeeded", payload: { ticker: "ERIC-B.ST" } }),
    job_artifacts: both("art", { job_id: "job_alice", kind: "quant" }),
    events: both("evt", { action: "login", status: "success" }),
    // The funnel stream. Alice also has an anonymous row from before she signed
    // up: it belongs to nobody, so erasure must leave it alone while removing
    // the two that name her.
    analytics_events: [
      { id: "ana_alice", user_id: ALICE, name: "session_start", origin: "server", anon_id: null, path: "/auth/login", properties: { method: "password" }, created_at: NOW },
      { id: "ana_bob", user_id: BOB, name: "session_start", origin: "server", anon_id: null, path: "/auth/login", properties: { method: "password" }, created_at: NOW },
      { id: "ana_anon", user_id: null, name: "landing_view", origin: "client", anon_id: "8f14e45f-ea1a-4a2f-9c1f-3b1f0e2d4a55", path: "/", properties: {}, created_at: NOW }
    ],
    user_roles: both("role", { role: "member" }),
    user_sessions: both("ses", { expires_at: "2099-01-01T00:00:00.000Z", revoked_at: null, revoked_reason: null }),
    password_reset_tokens: [
      { id: "prt_alice", user_id: ALICE, token_hash: "HASHED-RESET-TOKEN", expires_at: "2099-01-01T00:00:00.000Z", used_at: null, created_at: NOW }
    ],
    feature_requests: [
      { id: "frq_alice", user_id: ALICE, message: "Please add Nordnet", status: "new", source_page: "/portfolio", created_at: NOW, updated_at: NOW },
      { id: "frq_bob", user_id: BOB, message: "Dark mode", status: "new", source_page: null, created_at: NOW, updated_at: NOW }
    ],
    feature_request_comments: [
      { id: "frc_alice", feature_request_id: "frq_bob", user_id: ALICE, message: "Agreed", created_at: NOW, updated_at: NOW }
    ],
    feature_request_votes: [
      { id: "frv_alice", feature_request_id: "frq_bob", user_id: ALICE, anon_token_hash: null, created_at: NOW }
    ],
    release_notes: []
  };
}

async function withDb(run: (db: FakeSupabase) => Promise<void>): Promise<void> {
  const db = await startFakeSupabase(seed());
  const previousUrl = process.env.SUPABASE_URL;
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
  }
}

/** Every table the register knows about, as the guard sees them. */
async function personalTables(): Promise<string[]> {
  const { PERSONAL_DATA_TABLES } = await import("@/app/lib/account/personal-data");
  return [...new Set(PERSONAL_DATA_TABLES.map((entry) => entry.table))];
}

test("the export covers every table the register declares", async () => {
  await withDb(async () => {
    const { exportAccountData } = await import("@/app/lib/account/export");
    const { PERSONAL_DATA_TABLES } = await import("@/app/lib/account/personal-data");

    const data = await exportAccountData(ALICE);
    const exported = new Set(data.sections.map((section) => `${section.table}.${section.linkedBy}`));

    // Every register entry Alice actually has rows in must appear. Empty
    // sections are omitted from an export, so a table the fixture deliberately
    // gives her no rows in cannot be asserted on — each one is named here with
    // its reason, so the exemption stays a decision rather than a blind spot.
    const NO_FIXTURE_ROWS: Record<string, string> = {
      release_notes: "Alice authored none; release notes are company content.",
      trading_accounts:
        "Scaffolding. 0022_trading_accounts.sql is written but deliberately not applied, " +
        "so the table does not exist for the fixture to seed (docs/trading-platform.md §5)."
    };

    for (const entry of PERSONAL_DATA_TABLES) {
      if (NO_FIXTURE_ROWS[entry.table]) continue;
      assert.ok(
        exported.has(`${entry.table}.${entry.column}`),
        `export is missing ${entry.table}.${entry.column}`
      );
    }

    assert.equal(data.account?.id, ALICE);
    assert.equal(data.account?.email, "alice@example.se");
  });
});

test("the export hands over data, never credentials", async () => {
  await withDb(async () => {
    const { exportAccountData } = await import("@/app/lib/account/export");

    const serialised = JSON.stringify(await exportAccountData(ALICE));

    // A password hash, an encrypted broker token and a reset-token hash are all
    // keys to the account rather than facts about the person. Handing them to
    // whoever holds the download is strictly worse than withholding them.
    for (const secret of ["hash-alice", "v1.SECRET.MATERIAL", "v1.MORE.SECRET", "HASHED-RESET-TOKEN"]) {
      assert.equal(serialised.includes(secret), false, `export leaked ${secret}`);
    }

    // The surrounding metadata is still there, so the person can see the
    // connection existed and when it expires.
    assert.ok(serialised.includes("broker_connection_secrets"));
    assert.ok(serialised.includes("accounts"), "token scope should still be exported");
  });
});

test("the export contains only the caller's rows", async () => {
  await withDb(async () => {
    const { exportAccountData } = await import("@/app/lib/account/export");

    const serialised = JSON.stringify(await exportAccountData(ALICE));
    assert.equal(serialised.includes(BOB), false, "export leaked another user's id");
    assert.equal(serialised.includes("bob@example.se"), false);
    assert.equal(serialised.includes("Dark mode"), false, "export leaked another user's board post");
  });
});

test("erasure removes every trace of the person", async () => {
  await withDb(async (db) => {
    const { deleteAccount } = await import("@/app/lib/account/delete");

    const result = await deleteAccount(ALICE);
    assert.equal(result.userId, ALICE);

    for (const table of await personalTables()) {
      const survivors = db
        .rowsIn(table)
        .filter((row) => row.user_id === ALICE || row.created_by === ALICE || row.updated_by === ALICE);
      assert.deepEqual(survivors, [], `${table} still holds rows for the erased user`);
    }

    assert.equal(db.rowsIn("users").some((row) => row.id === ALICE), false, "the user row survived");
  });
});

test("erasure stops at the person's own rows", async () => {
  await withDb(async (db) => {
    const { deleteAccount } = await import("@/app/lib/account/delete");

    const before = Object.fromEntries(
      (await personalTables()).map((table) => [table, db.rowsIn(table).filter((row) => row.user_id === BOB).length])
    );

    await deleteAccount(ALICE);

    for (const [table, count] of Object.entries(before)) {
      const after = db.rowsIn(table).filter((row) => row.user_id === BOB).length;
      assert.equal(after, count, `erasing Alice changed Bob's rows in ${table}`);
    }
    assert.ok(db.rowsIn("users").some((row) => row.id === BOB), "Bob's account was deleted too");

    // The funnel stream is the one register table where a row can belong to
    // nobody — `landing_view` happens before an account exists. An erasure
    // keyed on `user_id` must leave those alone rather than sweeping up every
    // row with a null owner.
    assert.ok(
      db.rowsIn("analytics_events").some((row) => row.id === "ana_anon"),
      "erasing Alice deleted an anonymous funnel row that was never hers"
    );
  });
});

test("public board content is anonymised, not deleted", async () => {
  await withDb(async (db) => {
    const { deleteAccount } = await import("@/app/lib/account/delete");

    const result = await deleteAccount(ALICE);

    // The post and the reply survive — other people are reading that thread —
    // but they no longer point at anyone.
    const request = db.rowsIn("feature_requests").find((row) => row.id === "frq_alice");
    assert.ok(request, "the board post was deleted instead of anonymised");
    assert.equal(request?.user_id, null);
    assert.equal(request?.message, "Please add Nordnet", "the content should be untouched");

    const comment = db.rowsIn("feature_request_comments").find((row) => row.id === "frc_alice");
    assert.ok(comment, "the comment was deleted instead of anonymised");
    assert.equal(comment?.user_id, null);

    // A vote carries no content, so it goes.
    assert.equal(db.rowsIn("feature_request_votes").some((row) => row.id === "frv_alice"), false);

    assert.equal(result.anonymised["feature_requests.user_id"], 1);
    assert.equal(result.anonymised["feature_request_comments.user_id"], 1);
  });
});

test("a restricting foreign key is reported rather than blundered into", async () => {
  await withDb(async (db) => {
    const { deleteAccount, findAccountDeletionBlockers, AccountDeletionBlockedError } = await import(
      "@/app/lib/account/delete"
    );

    // Alice authored a release note. The schema says `on delete restrict`, so a
    // naive delete would fail at the database with an opaque error, halfway
    // through the erasure.
    await fetch(`${db.url}/rest/v1/release_notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { id: "rn_1", slug: "launch", status: "published", created_by: ALICE, updated_by: null, created_at: NOW, updated_at: NOW }
      ])
    });

    const blockers = await findAccountDeletionBlockers(ALICE);
    assert.equal(blockers.length, 1);
    assert.equal(blockers[0].table, "release_notes");
    assert.equal(blockers[0].column, "created_by");

    await assert.rejects(() => deleteAccount(ALICE), AccountDeletionBlockedError);

    // And crucially: it refused *before* deleting anything.
    assert.ok(db.rowsIn("users").some((row) => row.id === ALICE), "the account was partially erased");
    assert.equal(db.rowsIn("positions").filter((row) => row.user_id === ALICE).length, 1);
  });
});

test("erasure refuses a blank user id rather than matching everything", async () => {
  await withDb(async (db) => {
    const { deleteAccount } = await import("@/app/lib/account/delete");

    await assert.rejects(() => deleteAccount("   "), /requires a user id/);
    assert.equal(db.rowsIn("users").length, 2);
  });
});
