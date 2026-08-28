import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { findUserById } from "@/app/lib/auth/users";
import {
  createSessionRecord,
  findSessionById,
  isSessionActive,
  revokeSession,
  type SessionRevocationReason
} from "@/app/lib/auth/sessions";
import { ensureRuntimeEnv } from "@/app/lib/runtime/env";

export const SESSION_COOKIE_NAME = "disu_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  userId: string;
  email: string;
  /**
   * The `user_sessions` row this token names. Its absence is what makes a token
   * unrevokable, so a payload without one is rejected outright — see
   * `verifySessionToken`.
   */
  sid: string;
  exp: number;
};

type PublicSession = {
  userId: string;
  email: string;
  sessionId: string;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf-8");
}

function getSessionSecret(): string {
  ensureRuntimeEnv();
  return process.env.DISU_SESSION_SECRET!;
}

function signPayload(payloadB64: string): string {
  return createHmac("sha256", getSessionSecret()).update(payloadB64).digest("base64url");
}

/** Constant-time compare, matching the edge verifier in ./session-edge.ts. */
function signaturesMatch(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf-8");
  const actualBytes = Buffer.from(actual, "utf-8");
  if (expectedBytes.length !== actualBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, actualBytes);
}

function signSession(session: PublicSession, ttlSeconds: number): string {
  const payload: SessionPayload = {
    userId: session.userId,
    email: session.email,
    sid: session.sessionId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  return `${payloadB64}.${signPayload(payloadB64)}`;
}

/**
 * Opens a session: writes the `user_sessions` row first, then signs a token that
 * names it. Every sign-in path (password, register, Google) must go through
 * here — a token minted without a row would be permanently unrevokable.
 */
export async function issueSessionToken(user: { id: string; email: string }): Promise<string> {
  const record = await createSessionRecord(user.id, SESSION_TTL_SECONDS);
  return signSession({ userId: user.id, email: user.email, sessionId: record.id }, SESSION_TTL_SECONDS);
}

/**
 * Signature and expiry only — no database. Used where a cheap "is this even
 * plausible" answer is wanted; anything that acts on the caller's behalf must
 * use `getAuthenticatedSession()`, which also checks the session is still live.
 */
export function verifySessionToken(token: string): PublicSession | null {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) {
    return null;
  }
  if (!signaturesMatch(signPayload(payloadB64), signature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64)) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      return null;
    }
    if (!payload.userId || !payload.email) {
      return null;
    }
    // A correctly signed token with no `sid` predates revocation support and
    // could never be ended. Rejecting it is a one-time forced re-login, which is
    // the right trade against carrying an unrevokable credential forward.
    if (!payload.sid) {
      return null;
    }
    return { userId: payload.userId, email: payload.email, sessionId: payload.sid };
  } catch {
    return null;
  }
}

export function getSessionFromRequest(request: NextRequest): PublicSession | null {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }
  return verifySessionToken(token);
}

/**
 * The authoritative check, and the only one a handler should act on.
 *
 * Three things must all hold: the token is validly signed and unexpired, the
 * session row is live (not revoked, not expired), and the user still exists.
 */
export async function getAuthenticatedSession(request: NextRequest): Promise<PublicSession | null> {
  const session = getSessionFromRequest(request);
  if (!session) {
    return null;
  }
  return resolveSession(session);
}

/**
 * Same check as `getAuthenticatedSession`, for callers holding a token rather
 * than a request — the root layout reads the cookie via `next/headers`.
 */
export async function getAuthenticatedSessionFromToken(token: string | undefined): Promise<PublicSession | null> {
  if (!token) {
    return null;
  }
  const session = verifySessionToken(token);
  if (!session) {
    return null;
  }
  return resolveSession(session);
}

async function resolveSession(session: PublicSession): Promise<PublicSession | null> {
  const record = await findSessionById(session.sessionId);
  if (!record || !isSessionActive(record)) {
    return null;
  }
  // The signed token asserts an owner; the stored row is the one that counts.
  // They can only diverge if a token were forged, but comparing costs nothing.
  if (record.user_id !== session.userId) {
    return null;
  }

  const user = await findUserById(session.userId);
  if (!user) {
    return null;
  }

  return {
    userId: user.id,
    email: user.email,
    sessionId: record.id
  };
}

/** Ends the session a request is carrying. No-op when there is nothing live. */
export async function endSessionForRequest(
  request: NextRequest,
  reason: SessionRevocationReason
): Promise<void> {
  const session = getSessionFromRequest(request);
  if (!session) {
    return;
  }
  await revokeSession(session.userId, session.sessionId, reason);
}

export function getSessionCookieMaxAge(): number {
  return SESSION_TTL_SECONDS;
}
