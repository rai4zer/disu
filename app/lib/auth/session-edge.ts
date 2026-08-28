/**
 * Edge-runtime session verification.
 *
 * Middleware runs on the Edge runtime, so it cannot import
 * `app/lib/auth/session.ts` (node:crypto, and transitively node:fs via
 * ensureRuntimeEnv). This is the same HMAC-SHA256-over-base64url scheme
 * reimplemented on Web Crypto so middleware can reject a forged or expired
 * cookie instead of trusting that one is merely present.
 *
 * Keep in sync with the signing scheme in ./session.ts.
 *
 * This is a *signature* gate, not an authorization one: it cannot see whether
 * the session has been revoked, because Edge has no database access. The
 * authoritative check is `getAuthenticatedSession()` on the Node side, which
 * every API handler and the root layout go through.
 */

export const SESSION_COOKIE_NAME = "disu_session";

type PublicSession = {
  userId: string;
  email: string;
  sessionId: string;
};

type SessionPayload = {
  userId: string;
  email: string;
  sid: string;
  exp: number;
};

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time compare, so a mismatch does not leak where it diverged. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function sign(payloadB64: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function verifySessionTokenEdge(token: string, secret: string): Promise<PublicSession | null> {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) {
    return null;
  }

  let expected: string;
  try {
    expected = await sign(payloadB64, secret);
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, signature)) {
    return null;
  }

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64))) as SessionPayload;
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (!payload.userId || !payload.email) {
      return null;
    }
    // Middleware cannot reach the database to ask whether the session is still
    // live, but it can insist the token at least names one. A payload with no
    // `sid` predates revocation support and the Node verifier rejects it, so
    // accepting it here would render the signed-in shell for a token that dies
    // on the first API call.
    if (!payload.sid) {
      return null;
    }
    return { userId: payload.userId, email: payload.email, sessionId: payload.sid };
  } catch {
    return null;
  }
}
