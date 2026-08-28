import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  createGoogleState,
  GoogleAuthError,
  isGoogleSignInConfigured,
  parseGoogleState,
  sanitizeNextPath,
  verifyGoogleIdToken
} from "../app/lib/auth/google.ts";

const SESSION_SECRET = "test-session-secret";
const CLIENT_ID = "test-client-id.apps.googleusercontent.com";

// google.ts reads every env var lazily inside its functions, so setting these
// after the import is enough.
process.env.DISU_SESSION_SECRET = SESSION_SECRET;
process.env.GOOGLE_OAUTH_CLIENT_ID = CLIENT_ID;
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

/** Mirrors the module's own signing so tests can forge states it must reject. */
function encodeState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function encodeIdToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" }), "utf8").toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  // Signature is never checked — the token is only ever read straight off
  // Google's token endpoint — so any opaque segment is fine here.
  return `${header}.${payload}.c2lnbmF0dXJl`;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 300,
    sub: "1234567890",
    email: "User@Example.com",
    email_verified: true,
    name: "Test User",
    nonce: "expected-nonce",
    ...overrides
  };
}

function assertCode(fn: () => unknown, code: string) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof GoogleAuthError, `expected GoogleAuthError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

test("isGoogleSignInConfigured requires both client id and secret", () => {
  assert.equal(isGoogleSignInConfigured(), true);

  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  assert.equal(isGoogleSignInConfigured(), false);
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = secret;
});

test("sanitizeNextPath keeps relative paths and rejects off-site targets", () => {
  assert.equal(sanitizeNextPath("/portfolio?tab=holdings"), "/portfolio?tab=holdings");
  assert.equal(sanitizeNextPath("/dashboard"), "/dashboard");

  // Open-redirect guards.
  assert.equal(sanitizeNextPath("https://evil.example/steal"), "/dashboard");
  assert.equal(sanitizeNextPath("//evil.example/steal"), "/dashboard");
  assert.equal(sanitizeNextPath("portfolio"), "/dashboard");
  assert.equal(sanitizeNextPath(null), "/dashboard");
  assert.equal(sanitizeNextPath(""), "/dashboard");
});

test("state round-trips and carries the sanitized next path", () => {
  const state = createGoogleState({ nextPath: "/portfolio" });
  const parsed = parseGoogleState(state);
  assert.equal(parsed.nextPath, "/portfolio");
  assert.ok(parsed.nonce);

  const hostile = parseGoogleState(createGoogleState({ nextPath: "https://evil.example" }));
  assert.equal(hostile.nextPath, "/dashboard");
});

test("state defaults to the sign-in flow and carries link mode explicitly", () => {
  const signin = parseGoogleState(createGoogleState({ nextPath: "/portfolio" }));
  assert.equal(signin.mode, "signin");
  assert.equal(signin.linkUserId, null);

  const link = parseGoogleState(createGoogleState({ nextPath: "/account", mode: "link", linkUserId: "usr_alice" }));
  assert.equal(link.mode, "link");
  assert.equal(link.linkUserId, "usr_alice");
});

test("link mode cannot be reached without a user, and an unknown mode is a sign-in", () => {
  // A signed state is not forgeable, but the shapes still have to be safe:
  // "link" with nobody to link to must not fall through to the linking path,
  // and an unrecognised mode degrades to the weaker flow rather than the
  // stronger one.
  assertCode(
    () => parseGoogleState(encodeState({ nextPath: "/account", issuedAt: Date.now(), nonce: "abc", mode: "link" })),
    "invalid_state"
  );

  const odd = parseGoogleState(
    encodeState({ nextPath: "/account", issuedAt: Date.now(), nonce: "abc", mode: "elevate", linkUserId: "usr_alice" })
  );
  assert.equal(odd.mode, "signin");
  assert.equal(odd.linkUserId, null);

  // Asking for a link without a user id is refused at creation time too, rather
  // than minting a state the callback will only reject later.
  assertCode(() => parseGoogleState(createGoogleState({ nextPath: "/account", mode: "link" })), "invalid_state");
});

test("state with a tampered payload or signature is rejected", () => {
  const state = createGoogleState({ nextPath: "/portfolio" });
  const [body, signature] = state.split(".");

  assertCode(() => parseGoogleState(`${body}.${signature.slice(0, -2)}xx`), "invalid_state");
  assertCode(
    () => parseGoogleState(`${Buffer.from('{"nextPath":"/admin"}', "utf8").toString("base64url")}.${signature}`),
    "invalid_state"
  );
  assertCode(() => parseGoogleState(body), "invalid_state");
  assertCode(() => parseGoogleState(""), "invalid_state");
});

test("state older than its TTL is rejected even with a valid signature", () => {
  const stale = encodeState({
    nextPath: "/dashboard",
    issuedAt: Date.now() - 1000 * 60 * 11,
    nonce: "abc"
  });
  assertCode(() => parseGoogleState(stale), "expired_state");
});

test("verifyGoogleIdToken accepts a well-formed token and normalizes the email", () => {
  const identity = verifyGoogleIdToken(encodeIdToken(validClaims()), "expected-nonce");
  assert.deepEqual(identity, {
    sub: "1234567890",
    email: "user@example.com",
    emailVerified: true,
    name: "Test User"
  });
});

test("verifyGoogleIdToken rejects tokens minted for another audience or issuer", () => {
  assertCode(
    () => verifyGoogleIdToken(encodeIdToken(validClaims({ aud: "someone-else.apps.googleusercontent.com" })), "expected-nonce"),
    "invalid_id_token"
  );
  assertCode(
    () => verifyGoogleIdToken(encodeIdToken(validClaims({ iss: "https://accounts.evil.example" })), "expected-nonce"),
    "invalid_id_token"
  );
});

test("verifyGoogleIdToken rejects expired tokens and replayed nonces", () => {
  assertCode(
    () => verifyGoogleIdToken(encodeIdToken(validClaims({ exp: Math.floor(Date.now() / 1000) - 1 })), "expected-nonce"),
    "invalid_id_token"
  );
  assertCode(() => verifyGoogleIdToken(encodeIdToken(validClaims()), "a-different-nonce"), "invalid_id_token");
  assertCode(() => verifyGoogleIdToken(encodeIdToken(validClaims()), ""), "invalid_id_token");
});

test("verifyGoogleIdToken rejects malformed tokens and missing claims", () => {
  assertCode(() => verifyGoogleIdToken("not-a-jwt", "expected-nonce"), "invalid_id_token");
  assertCode(() => verifyGoogleIdToken("a.b.c", "expected-nonce"), "invalid_id_token");
  assertCode(() => verifyGoogleIdToken(encodeIdToken(validClaims({ sub: undefined })), "expected-nonce"), "invalid_id_token");
  assertCode(() => verifyGoogleIdToken(encodeIdToken(validClaims({ email: undefined })), "expected-nonce"), "email_missing");
});

test("verifyGoogleIdToken reports email_verified without throwing so the caller decides", () => {
  const unverified = verifyGoogleIdToken(encodeIdToken(validClaims({ email_verified: false })), "expected-nonce");
  assert.equal(unverified.emailVerified, false);

  // Google emits a real boolean on the id_token but the string "true" elsewhere.
  const stringy = verifyGoogleIdToken(encodeIdToken(validClaims({ email_verified: "true" })), "expected-nonce");
  assert.equal(stringy.emailVerified, true);

  const missing = verifyGoogleIdToken(encodeIdToken(validClaims({ email_verified: undefined })), "expected-nonce");
  assert.equal(missing.emailVerified, false);
});

test("verifyGoogleIdToken omits a blank name rather than returning empty string", () => {
  const identity = verifyGoogleIdToken(encodeIdToken(validClaims({ name: "  " })), "expected-nonce");
  assert.equal(identity.name, null);
});
