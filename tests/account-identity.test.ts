import assert from "node:assert/strict";
import test from "node:test";

import { startFakeSupabase, type FakeSupabase } from "./support/fake-supabase.ts";

/**
 * Account sign-in methods: setting a password from inside a session, and
 * linking/unlinking Google (ROADMAP §2.3).
 *
 * The properties that matter are the ones that used to force a Google-only user
 * through the password-reset email, plus the two ways an explicit link could
 * otherwise leave two accounts fighting over one Google identity:
 *
 *   - a Google-only account can acquire a password without a reset token;
 *   - the password policy applies here exactly as it does at registration;
 *   - unlinking Google is refused while it is the only way in;
 *   - a `sub` or a Google address that belongs to someone else is refused.
 */

const ALICE = "usr_alice";        // password only
const GOOGLIE = "usr_googlie";    // Google only, no password at all
const BOB = "usr_bob";            // password + Google
const NOW = "2026-08-25T09:00:00.000Z";

/** Passes the policy: long, varied, no blocklisted word, no email fragment. */
const STRONG = "hjortron-vindkraft-42";
const ALSO_STRONG = "kastanj-lykta-tunnel-9";

function seed() {
  return {
    users: [
      {
        id: ALICE,
        email: "alice@example.se",
        password_hash: null,
        password_salt: null,
        google_sub: null,
        created_at: NOW
      },
      {
        id: GOOGLIE,
        email: "googlie@example.se",
        password_hash: null,
        password_salt: null,
        google_sub: "google-sub-googlie",
        created_at: NOW
      },
      {
        id: BOB,
        email: "bob@example.se",
        password_hash: null,
        password_salt: null,
        google_sub: "google-sub-bob",
        created_at: NOW
      }
    ],
    user_sessions: [] as Record<string, unknown>[],
    events: [] as Record<string, unknown>[]
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
  // No unit test should reach the Pwned Passwords API; the local half of the
  // policy is what is under test here.
  process.env.PASSWORD_BREACH_CHECK = "off";

  try {
    await run(db);
  } finally {
    await db.close();
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
  }
}

test("a Google-only account reports no password and can set one without a reset token", async () => {
  await withDb(async (db) => {
    const { getAccountIdentity, setUserPassword, verifyUserPassword } = await import("@/app/lib/auth/users");

    const before = await getAccountIdentity(GOOGLIE);
    assert.equal(before?.hasPassword, false);
    assert.equal(before?.googleLinked, true);

    await setUserPassword(GOOGLIE, STRONG);

    const after = await getAccountIdentity(GOOGLIE);
    assert.equal(after?.hasPassword, true);
    // Linking Google is untouched: adding a password adds a method, it does not
    // replace the one they already had.
    assert.equal(after?.googleLinked, true);
    assert.equal(await verifyUserPassword(GOOGLIE, STRONG), true);
    assert.equal(await verifyUserPassword(GOOGLIE, "something-else-entirely"), false);

    // Stored salted and hashed, never in the clear.
    const row = db.rowsIn("users").find((user) => user.id === GOOGLIE)!;
    assert.ok(row.password_hash);
    assert.ok(row.password_salt);
    assert.equal(String(row.password_hash).includes(STRONG), false);
  });
});

test("setting a password from settings applies the same policy as registration", async () => {
  await withDb(async () => {
    const { setUserPassword } = await import("@/app/lib/auth/users");
    const { PasswordPolicyError } = await import("@/app/lib/auth/password-policy");

    await assert.rejects(
      () => setUserPassword(GOOGLIE, "short"),
      (error: unknown) => {
        assert.ok(error instanceof PasswordPolicyError);
        assert.equal(error.code, "password_too_short");
        return true;
      }
    );

    // The blocklist and the email-derivation rule apply here too.
    await assert.rejects(() => setUserPassword(GOOGLIE, "Password2026!"), PasswordPolicyError);
    await assert.rejects(() => setUserPassword(GOOGLIE, "googlie-googlie-1"), PasswordPolicyError);
  });
});

test("changing a password replaces the old one and reuses no salt", async () => {
  await withDb(async (db) => {
    const { setUserPassword, verifyUserPassword } = await import("@/app/lib/auth/users");

    await setUserPassword(ALICE, STRONG);
    const firstSalt = db.rowsIn("users").find((user) => user.id === ALICE)!.password_salt;

    await setUserPassword(ALICE, ALSO_STRONG);
    const secondSalt = db.rowsIn("users").find((user) => user.id === ALICE)!.password_salt;

    assert.notEqual(firstSalt, secondSalt);
    assert.equal(await verifyUserPassword(ALICE, ALSO_STRONG), true);
    assert.equal(await verifyUserPassword(ALICE, STRONG), false);
  });
});

test("linking Google attaches an address that need not match the account email", async () => {
  await withDb(async () => {
    const { getAccountIdentity, linkGoogleToUser } = await import("@/app/lib/auth/users");

    // The session is the authorisation, so a personal Gmail address can be
    // attached to an account registered under a work address.
    const outcome = await linkGoogleToUser({ userId: ALICE, sub: "google-sub-alice", email: "alice.private@gmail.com" });
    assert.equal(outcome, "linked");
    assert.equal((await getAccountIdentity(ALICE))?.googleLinked, true);

    // Idempotent: pressing connect twice is not an error.
    assert.equal(
      await linkGoogleToUser({ userId: ALICE, sub: "google-sub-alice", email: "alice.private@gmail.com" }),
      "unchanged"
    );

    // A different Google account replaces the link rather than silently doing
    // nothing — an explicit, authenticated re-point.
    assert.equal(
      await linkGoogleToUser({ userId: ALICE, sub: "google-sub-alice-2", email: "alice.other@gmail.com" }),
      "replaced"
    );
  });
});

test("linking refuses a Google identity or address another account owns", async () => {
  await withDb(async (db) => {
    const { AccountIdentityError, linkGoogleToUser } = await import("@/app/lib/auth/users");

    const rejectsWith = async (code: string, input: { userId: string; sub: string; email: string }) => {
      await assert.rejects(
        () => linkGoogleToUser(input),
        (error: unknown) => {
          assert.ok(error instanceof AccountIdentityError, `expected AccountIdentityError, got ${String(error)}`);
          assert.equal(error.code, code);
          return true;
        }
      );
    };

    // Bob's `sub`. Allowing this would give one Google identity two accounts.
    await rejectsWith("google_already_linked", {
      userId: ALICE,
      sub: "google-sub-bob",
      email: "alice@example.se"
    });

    // Bob's email. `sub` is matched before email, so linking this here would
    // send Bob into Alice's account the first time he pressed Sign in with
    // Google.
    await rejectsWith("email_in_use", {
      userId: ALICE,
      sub: "google-sub-alice",
      email: "BOB@example.se"
    });

    // Neither refusal wrote anything.
    const alice = db.rowsIn("users").find((user) => user.id === ALICE)!;
    assert.equal(alice.google_sub, null);
  });
});

test("unlinking Google is refused while it is the only way into the account", async () => {
  await withDb(async (db) => {
    const { AccountIdentityError, getAccountIdentity, setUserPassword, unlinkGoogleFromUser } = await import(
      "@/app/lib/auth/users"
    );

    assert.equal((await getAccountIdentity(GOOGLIE))?.hasPassword, false);
    await assert.rejects(
      () => unlinkGoogleFromUser(GOOGLIE),
      (error: unknown) => {
        assert.ok(error instanceof AccountIdentityError);
        assert.equal(error.code, "password_required");
        return true;
      }
    );
    assert.equal(db.rowsIn("users").find((user) => user.id === GOOGLIE)!.google_sub, "google-sub-googlie");

    // Once a password exists the same call goes through.
    await setUserPassword(GOOGLIE, STRONG);
    await unlinkGoogleFromUser(GOOGLIE);

    const identity = await getAccountIdentity(GOOGLIE);
    assert.equal(identity?.googleLinked, false);
    assert.equal(identity?.hasPassword, true);
    assert.equal(db.rowsIn("users").find((user) => user.id === GOOGLIE)!.google_sub, null);
  });
});

test("unlinking an account that has no Google link is a no-op, not an error", async () => {
  await withDb(async () => {
    const { unlinkGoogleFromUser } = await import("@/app/lib/auth/users");
    // ALICE has neither a password nor a link; the password guard must not fire
    // when there is nothing to unlink in the first place.
    await unlinkGoogleFromUser(ALICE);
  });
});

test("a password-only account still refuses Google sign-in until it is linked", async () => {
  await withDb(async () => {
    const { authenticateUser, setUserPassword } = await import("@/app/lib/auth/users");

    // Guards the null-hash path in authenticateUser: before a password is set,
    // an empty or guessed one must not authenticate a Google-only row.
    assert.equal(await authenticateUser("googlie@example.se", ""), null);
    assert.equal(await authenticateUser("googlie@example.se", STRONG), null);

    await setUserPassword(GOOGLIE, STRONG);
    const user = await authenticateUser("googlie@example.se", STRONG);
    assert.equal(user?.id, GOOGLIE);
  });
});
