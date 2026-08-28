import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { startFakeSupabase, type FakeSupabase } from "./support/fake-supabase.ts";

/**
 * Server-side session revocation (ROADMAP §2.3, risk R11).
 *
 * The property under test is the one the stateless cookie could not provide: a
 * token that is perfectly signed and unexpired must stop working the moment its
 * session row is revoked.
 */

const USER_ID = "usr_revocation";
const EMAIL = "revocation@example.se";

function seed() {
  return {
    users: [
      {
        id: USER_ID,
        email: EMAIL,
        password_hash: null,
        password_salt: null,
        google_sub: "google-sub-1",
        created_at: "2026-08-01T00:00:00.000Z"
      }
    ],
    user_sessions: [],
    password_reset_tokens: [],
    events: []
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

test("a signed token stops working the moment its session is revoked", async () => {
  await withDb(async (db) => {
    const { issueSessionToken, getAuthenticatedSessionFromToken, verifySessionToken } = await import(
      "@/app/lib/auth/session"
    );
    const { revokeSession } = await import("@/app/lib/auth/sessions");

    const token = await issueSessionToken({ id: USER_ID, email: EMAIL });
    const resolved = await getAuthenticatedSessionFromToken(token);
    assert.equal(resolved?.userId, USER_ID);
    const sessionId = resolved!.sessionId;

    await revokeSession(USER_ID, sessionId, "signed_out");

    // The signature is still perfectly valid and the token is nowhere near
    // expiry — the *only* thing that changed is the stored row. That is the
    // whole point: revocation cannot depend on the token changing.
    assert.ok(verifySessionToken(token), "the token itself must still verify");
    assert.equal(await getAuthenticatedSessionFromToken(token), null);

    const row = db.rowsIn("user_sessions").find((session) => session.id === sessionId);
    assert.equal(row?.revoked_reason, "signed_out");
  });
});

test("revoking one session leaves the others alone", async () => {
  await withDb(async () => {
    const { issueSessionToken, getAuthenticatedSessionFromToken } = await import("@/app/lib/auth/session");
    const { revokeSession } = await import("@/app/lib/auth/sessions");

    const laptop = await issueSessionToken({ id: USER_ID, email: EMAIL });
    const phone = await issueSessionToken({ id: USER_ID, email: EMAIL });

    const laptopSession = await getAuthenticatedSessionFromToken(laptop);
    await revokeSession(USER_ID, laptopSession!.sessionId, "signed_out");

    assert.equal(await getAuthenticatedSessionFromToken(laptop), null);
    assert.equal((await getAuthenticatedSessionFromToken(phone))?.userId, USER_ID, "the phone stays signed in");
  });
});

test("a password reset ends every session that already existed", async () => {
  await withDb(async () => {
    const { issueSessionToken, getAuthenticatedSessionFromToken } = await import("@/app/lib/auth/session");
    const { revokeAllSessionsForUser } = await import("@/app/lib/auth/sessions");

    // Two devices signed in — one of them the intruder's.
    const victim = await issueSessionToken({ id: USER_ID, email: EMAIL });
    const intruder = await issueSessionToken({ id: USER_ID, email: EMAIL });

    const revoked = await revokeAllSessionsForUser(USER_ID, "password_reset");
    assert.equal(revoked, 2);

    assert.equal(await getAuthenticatedSessionFromToken(victim), null);
    assert.equal(await getAuthenticatedSessionFromToken(intruder), null);

    // And the victim can sign in again afterwards without inheriting the block.
    const fresh = await issueSessionToken({ id: USER_ID, email: EMAIL });
    assert.equal((await getAuthenticatedSessionFromToken(fresh))?.userId, USER_ID);
  });
});

test("an expired session row is dead even before the token expires", async () => {
  await withDb(async (db) => {
    const { issueSessionToken, getAuthenticatedSessionFromToken } = await import("@/app/lib/auth/session");

    const token = await issueSessionToken({ id: USER_ID, email: EMAIL });
    const session = await getAuthenticatedSessionFromToken(token);

    // Backdate the row's expiry without touching the token.
    const row = db.rowsIn("user_sessions").find((entry) => entry.id === session!.sessionId);
    await fetch(`${db.url}/rest/v1/user_sessions?id=eq.${row!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ expires_at: "2020-01-01T00:00:00.000Z" })
    });

    assert.equal(await getAuthenticatedSessionFromToken(token), null);
  });
});

test("a token naming a session that does not exist is refused", async () => {
  await withDb(async (db) => {
    const { issueSessionToken, getAuthenticatedSessionFromToken } = await import("@/app/lib/auth/session");

    const token = await issueSessionToken({ id: USER_ID, email: EMAIL });
    const session = await getAuthenticatedSessionFromToken(token);

    await fetch(`${db.url}/rest/v1/user_sessions?id=eq.${session!.sessionId}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });

    assert.equal(await getAuthenticatedSessionFromToken(token), null);
  });
});

test("expired session rows are pruned, live ones are not", async () => {
  await withDb(async (db) => {
    const { issueSessionToken } = await import("@/app/lib/auth/session");
    const { pruneExpiredSessions } = await import("@/app/lib/auth/sessions");

    await issueSessionToken({ id: USER_ID, email: EMAIL });
    const stale = await issueSessionToken({ id: USER_ID, email: EMAIL });
    const { verifySessionToken } = await import("@/app/lib/auth/session");
    const staleId = verifySessionToken(stale)!.sessionId;

    await fetch(`${db.url}/rest/v1/user_sessions?id=eq.${staleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ expires_at: "2020-01-01T00:00:00.000Z" })
    });

    assert.equal(await pruneExpiredSessions(), 1);
    const remaining = db.rowsIn("user_sessions");
    assert.equal(remaining.length, 1);
    assert.notEqual(remaining[0].id, staleId);
  });
});

test("one user cannot revoke another user's session", async () => {
  await withDb(async (db) => {
    const { issueSessionToken, getAuthenticatedSessionFromToken } = await import("@/app/lib/auth/session");
    const { revokeSession, revokeAllSessionsForUser } = await import("@/app/lib/auth/sessions");

    const token = await issueSessionToken({ id: USER_ID, email: EMAIL });
    const session = await getAuthenticatedSessionFromToken(token);

    // Holding somebody's session id must not be enough to end their session.
    await revokeSession("usr_someone_else", session!.sessionId, "signed_out");
    await revokeAllSessionsForUser("usr_someone_else", "signed_out_everywhere");

    assert.equal((await getAuthenticatedSessionFromToken(token))?.userId, USER_ID);
    assert.equal(db.rowsIn("user_sessions")[0].revoked_at, null);
  });
});

test("a token whose stored owner disagrees with its payload is refused", async () => {
  await withDb(async (db) => {
    const { issueSessionToken, getAuthenticatedSessionFromToken } = await import("@/app/lib/auth/session");

    const token = await issueSessionToken({ id: USER_ID, email: EMAIL });
    const session = await getAuthenticatedSessionFromToken(token);

    await fetch(`${db.url}/rest/v1/user_sessions?id=eq.${session!.sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: "usr_someone_else" })
    });

    assert.equal(await getAuthenticatedSessionFromToken(token), null);
  });
});

/**
 * The chrome half of the same contract.
 *
 * `app/layout.tsx` resolves `signedIn` on the server and hands it to `AppShell`,
 * which is what decides between the module rail and the signed-out nav. A
 * client-side `router.replace()` reuses the cached RSC payload for shared
 * layouts, so a session transition that does not also call `router.refresh()`
 * leaves the *previous* answer on screen: sign in and the app still offers you
 * "Skapa konto", with no modules, while the page's own fetches succeed because
 * the cookie is perfectly good.
 *
 * Source-level because the failure is a missing call in a client component —
 * there is no server behaviour to assert against.
 */
test("every client-side session transition refreshes the server-rendered chrome", () => {
  const transitions = [
    ["app/auth/login/login-form.tsx", "sign-in and registration"],
    ["app/components/logout-button.tsx", "sign-out"]
  ] as const;

  for (const [file, what] of transitions) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    const replaces = source.match(/router\.replace\(/g)?.length ?? 0;
    const refreshes = source.match(/router\.refresh\(/g)?.length ?? 0;
    assert.ok(replaces > 0, `${file}: expected a navigation on ${what}`);
    assert.equal(
      refreshes,
      replaces,
      `${file}: ${what} navigates ${replaces}x but refreshes ${refreshes}x — the layout keeps the stale signedIn`
    );
  }
});
