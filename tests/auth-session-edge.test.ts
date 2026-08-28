import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { verifySessionTokenEdge } from "../app/lib/auth/session-edge.ts";

const SECRET = "test-session-secret-with-some-length-1234567890";

// Mirrors createSessionToken() in app/lib/auth/session.ts. Kept local rather than
// imported so this asserts cross-runtime parity of the *scheme*: middleware runs
// the Web Crypto verifier on the Edge runtime and must accept exactly the tokens
// the node:crypto signer issues.
function nodeSign(session: { userId: string; email: string; sid?: string }, ttlSeconds = 3600): string {
  const payload = { sid: "ses_test", ...session, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const signature = createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${signature}`;
}

test("accepts a token signed by the node implementation", async () => {
  const token = nodeSign({ userId: "user-1", email: "a@b.se" });
  assert.deepEqual(await verifySessionTokenEdge(token, SECRET), {
    userId: "user-1",
    email: "a@b.se",
    sessionId: "ses_test"
  });
});

test("accepts payloads at every base64url padding length", async () => {
  // Node emits unpadded base64url; the edge decoder has to re-add the padding.
  for (const email of ["a@b.se", "aa@b.se", "aaa@b.se", "aaaa@b.se", "åäö@exempel.se"]) {
    const token = nodeSign({ userId: "user-1", email });
    assert.deepEqual(
      await verifySessionTokenEdge(token, SECRET),
      { userId: "user-1", email, sessionId: "ses_test" },
      email
    );
  }
});

test("rejects a forged or malformed token", async () => {
  const [payloadB64] = nodeSign({ userId: "user-1", email: "a@b.se" }).split(".");
  assert.equal(await verifySessionTokenEdge(`${payloadB64}.forged`, SECRET), null);
  assert.equal(await verifySessionTokenEdge("garbage.notasignature", SECRET), null);
  assert.equal(await verifySessionTokenEdge("nodotatall", SECRET), null);
  assert.equal(await verifySessionTokenEdge("", SECRET), null);
});

test("rejects the wrong secret", async () => {
  const token = nodeSign({ userId: "user-1", email: "a@b.se" });
  assert.equal(await verifySessionTokenEdge(token, "a-different-secret"), null);
});

test("rejects an expired token", async () => {
  assert.equal(await verifySessionTokenEdge(nodeSign({ userId: "user-1", email: "a@b.se" }, -1), SECRET), null);
});

test("rejects a correctly signed payload that names no session", async () => {
  // A token with no `sid` cannot be revoked, so middleware must not let it
  // render the signed-in shell — the Node verifier rejects it either way.
  const payloadB64 = Buffer.from(
    JSON.stringify({ userId: "user-1", email: "a@b.se", exp: Math.floor(Date.now() / 1000) + 3600 }),
    "utf-8"
  ).toString("base64url");
  const signature = createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
  assert.equal(await verifySessionTokenEdge(`${payloadB64}.${signature}`, SECRET), null);
});

test("rejects a correctly signed payload that is missing identity fields", async () => {
  const payloadB64 = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }), "utf-8").toString(
    "base64url"
  );
  const signature = createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
  assert.equal(await verifySessionTokenEdge(`${payloadB64}.${signature}`, SECRET), null);
});
