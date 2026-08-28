/**
 * Structural tenant scoping for user-owned tables.
 *
 * Every handler runs with the Supabase **service-role** key, which bypasses RLS
 * (architecture.md §Security). Authorization is therefore entirely a matter of
 * every query carrying its own `user_id` filter — and a filter you have to
 * remember is a filter you will eventually forget. One omission on any of these
 * tables is a cross-user data leak (ROADMAP R2, severity Critical).
 *
 * `userScoped()` removes the choice: the caller passes the user id as the first
 * argument and cannot express a query without it. Reads, updates and deletes get
 * `user_id=eq.<id>` injected; inserts get `user_id` stamped onto every row. An
 * attempt to pass `user_id` yourself throws rather than being merged, because
 * the only reason to do so is to widen the scope.
 *
 * Genuinely cross-tenant work — the job worker draining the queue, retention
 * pruning — goes through `systemRequest()`, which is loud on purpose and demands
 * a written reason. `scripts/check-delivery-readiness.mjs` fails the build if a
 * user-owned table is reached through the raw client instead.
 */

import { eq, supabaseRequest } from "@/app/lib/db/supabase";

/**
 * Tables with a `user_id` column that scopes rows to one account.
 *
 * Deliberately *not* listed: `users` (keyed by `id`, and the auth layer looks
 * rows up by email before a session exists), `release_notes` /
 * `release_note_translations` (global, admin-authored), `feature_requests` and
 * its comments/votes (a public board — every user reads every row by design),
 * and `password_reset_tokens` (looked up by token hash by an anonymous caller).
 *
 * `analytics_events` is the other deliberate absence, and the interesting one:
 * its `user_id` is *nullable*, because the funnel steps that matter most happen
 * before an account exists (`app/lib/analytics/funnel-store.ts`). A table where
 * a row legitimately belongs to nobody cannot be scoped to somebody, so the
 * property that replaces tenant scoping there is that the app only ever writes
 * to it — no route reads a row back, per user or otherwise.
 */
export const USER_OWNED_TABLES = [
  "broker_connection_accounts",
  "broker_connection_secrets",
  "broker_connections",
  "events",
  "job_artifacts",
  "jobs",
  "manual_positions",
  "portfolio_snapshots",
  "positions",
  "user_roles",
  "user_sessions"
] as const;

export type UserOwnedTable = (typeof USER_OWNED_TABLES)[number];

type ScopedRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Filters and PostgREST modifiers. May not contain `user_id`. */
  query?: Record<string, string>;
  /** A row or array of rows for POST; a patch object for PATCH. */
  body?: unknown;
  prefer?: string;
};

function assertUserId(userId: string, table: string): string {
  const trimmed = userId?.trim();
  if (!trimmed) {
    // An empty id would produce `user_id=eq.` — a filter that quietly matches
    // nothing, turning an auth bug into an empty list instead of an error.
    throw new Error(`userScoped("${table}") called without a user id.`);
  }
  return trimmed;
}

function scopeRow(row: unknown, userId: string, table: string): Record<string, unknown> {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`userScoped("${table}") insert rows must be objects.`);
  }

  const record = row as Record<string, unknown>;
  const declared = record.user_id;
  if (declared !== undefined && declared !== null && declared !== userId) {
    throw new Error(`userScoped("${table}") insert declares user_id "${String(declared)}" but is scoped to "${userId}".`);
  }

  return { ...record, user_id: userId };
}

/**
 * Runs a Supabase REST request that can only ever touch `userId`'s rows.
 */
export async function userScoped<T>(
  userId: string,
  table: UserOwnedTable,
  options: ScopedRequestOptions = {}
): Promise<T> {
  const scopedUserId = assertUserId(userId, table);
  const method = options.method ?? "GET";

  if (options.query && "user_id" in options.query) {
    throw new Error(
      `userScoped("${table}") received a user_id filter. The scope comes from the first argument — ` +
        "pass it there, or use systemRequest() if this really is cross-tenant work."
    );
  }

  if (method === "POST") {
    const rows = Array.isArray(options.body) ? options.body : [options.body];
    return supabaseRequest<T>(table, {
      ...options,
      method,
      body: rows.map((row) => scopeRow(row, scopedUserId, table))
    });
  }

  return supabaseRequest<T>(table, {
    ...options,
    method,
    query: { ...(options.query ?? {}), user_id: eq(scopedUserId) }
  });
}

/**
 * Escape hatch for work that legitimately spans every tenant: the job worker
 * claiming queued rows, orphan recovery, retention pruning.
 *
 * `reason` is not logged — it exists so the call site has to say out loud why it
 * is exempt, and so a reviewer can tell an intentional sweep from a forgotten
 * filter at a glance.
 */
export async function systemRequest<T>(
  table: UserOwnedTable,
  options: ScopedRequestOptions & { reason: string }
): Promise<T> {
  const { reason, ...rest } = options;
  if (!reason.trim()) {
    throw new Error(`systemRequest("${table}") requires a reason.`);
  }
  return supabaseRequest<T>(table, rest);
}
