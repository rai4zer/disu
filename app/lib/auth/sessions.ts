/**
 * Server-side session records.
 *
 * The cookie is still a signed token — that is what makes it cheap to reject a
 * forgery without touching the database. What changed is that a valid signature
 * is no longer sufficient: the token names a session row (`sid`), and a row that
 * is missing, revoked or expired kills the token however well it is signed.
 *
 * That is what makes these possible, none of which the stateless cookie could do
 * (ROADMAP §2.3, risk R11):
 *
 *   - Logging out actually ends the session, rather than only clearing the
 *     browser's copy of a token that stays valid for another seven days.
 *   - Resetting a password kicks out whoever was already signed in — the single
 *     most important thing a compromised user can do, and previously impossible
 *     without rotating the global secret and signing out every other user too.
 *   - One session can be ended without touching the others.
 */

import { randomUUID } from "node:crypto";
import { eq, lt } from "@/app/lib/db/supabase";
import { systemRequest, userScoped } from "@/app/lib/db/user-scope";

export type SessionRow = {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
};

/**
 * Why a session ended. Stored rather than inferred so that "the user signed
 * out" and "we invalidated this because the password changed" stay
 * distinguishable when reading the table months later.
 */
export type SessionRevocationReason =
  | "signed_out"
  | "password_reset"
  | "password_changed"
  | "signed_out_everywhere";

const SESSION_COLUMNS = "id,user_id,created_at,expires_at,revoked_at,revoked_reason";

function createSessionId(): string {
  return `ses_${randomUUID().replace(/-/g, "")}`;
}

export function isSessionActive(row: SessionRow, now = Date.now()): boolean {
  if (row.revoked_at) {
    return false;
  }
  const expiresAt = Date.parse(row.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export async function createSessionRecord(userId: string, ttlSeconds: number): Promise<SessionRow> {
  const now = new Date();
  const rows = await userScoped<SessionRow[]>(userId, "user_sessions", {
    method: "POST",
    body: [
      {
        id: createSessionId(),
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
        revoked_at: null,
        revoked_reason: null
      }
    ]
  });
  return rows[0];
}

/**
 * Looks a session up by its id alone.
 *
 * Unscoped by necessity, not by oversight: this runs *before* identity is
 * established — the session id is what tells us who the caller is. The id is a
 * 128-bit random value, so it is the credential, and the caller cannot enumerate
 * other rows with it.
 */
export async function findSessionById(sessionId: string): Promise<SessionRow | null> {
  if (!sessionId.trim()) {
    return null;
  }
  const rows = await systemRequest<SessionRow[]>("user_sessions", {
    reason: "the session id is what establishes identity, so it cannot itself be user-scoped",
    query: {
      id: eq(sessionId),
      select: SESSION_COLUMNS,
      limit: "1"
    }
  });
  return rows[0] ?? null;
}

/**
 * Ends one session. Scoped to its owner so that holding a session id is not on
 * its own enough to end someone else's session.
 */
export async function revokeSession(
  userId: string,
  sessionId: string,
  reason: SessionRevocationReason
): Promise<void> {
  await userScoped<SessionRow[]>(userId, "user_sessions", {
    method: "PATCH",
    query: {
      id: eq(sessionId),
      revoked_at: "is.null",
      select: SESSION_COLUMNS
    },
    body: {
      revoked_at: new Date().toISOString(),
      revoked_reason: reason
    }
  });
}

/**
 * Ends every live session for one user — what a password reset must do, and what
 * a "sign out everywhere" control would call.
 */
export async function revokeAllSessionsForUser(
  userId: string,
  reason: SessionRevocationReason
): Promise<number> {
  const revoked = await userScoped<SessionRow[]>(userId, "user_sessions", {
    method: "PATCH",
    query: {
      revoked_at: "is.null",
      select: SESSION_COLUMNS
    },
    body: {
      revoked_at: new Date().toISOString(),
      revoked_reason: reason
    }
  });
  return revoked.length;
}

/**
 * Retention: once a session is past its expiry no token can reference it, so the
 * row is dead weight. Revoked-but-unexpired rows are kept until they expire so
 * the reason stays readable while the token could still be presented.
 */
export async function pruneExpiredSessions(now = new Date()): Promise<number> {
  const deleted = await systemRequest<Array<{ id: string }>>("user_sessions", {
    reason: "retention pruning is defined by expiry, across all tenants",
    method: "DELETE",
    query: {
      expires_at: lt(now.toISOString()),
      select: "id"
    },
    prefer: "return=representation,count=exact"
  });
  return deleted.length;
}
