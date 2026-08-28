/**
 * Writing funnel events, and the one gate every write goes through.
 *
 * `analytics_events` is not a user-owned table (`app/lib/db/user-scope.ts`
 * explains why it is deliberately absent from `USER_OWNED_TABLES`): its
 * `user_id` is nullable because the two events that matter most —
 * `landing_view`, `signup_start` — happen before an account exists. So it is
 * reached through `supabaseRequest()` directly, and the safety property that
 * replaces tenant scoping is that **the app only ever writes here, never reads
 * per-user**. There is no route that returns a row from this table.
 *
 * The gate is `analyticsAllowed()`. The privacy policy names consent as the only
 * basis DISU uses for analytics, so a first-party funnel is in exactly the same
 * position as the GA4 tag: no consent, no row. It is enforced here rather than in
 * the caller because a gate you have to remember is a gate that ships open.
 *
 * The consequence worth knowing: consent lives in a cookie on the request, so a
 * funnel event can only be recorded where a request is in scope. That is why
 * `quant_run` and `primer_run` are recorded at enqueue in the API route and not
 * in `app/lib/jobs/processor.ts`, which runs minutes later with no request and
 * therefore no lawful basis to write anything.
 */

import { CONSENT_COOKIE_NAME, hasConsent, parseConsent } from "@/app/lib/legal/consent";
import { lt, supabaseRequest } from "@/app/lib/db/supabase";
import {
  FUNNEL_EVENT_SPECS,
  sanitiseProperties,
  type FunnelEventName,
  type FunnelProperties
} from "@/app/lib/analytics/funnel";

export const ANALYTICS_EVENTS_TABLE = "analytics_events";

/** Just enough of a request to read the consent cookie off it. */
type ConsentCarrier = {
  cookies: { get(name: string): { value: string } | undefined };
};

/**
 * Whether this request's visitor has agreed to analytics.
 *
 * Fails closed on anything it cannot read: a missing, malformed, expired or
 * older-version record is `null` from `parseConsent()`, and `hasConsent(null, …)`
 * is false. A forged cookie can only ever grant *more* measurement of the forger
 * themselves, which is why this is safe to trust while a session cookie is not.
 */
export function analyticsAllowed(request: ConsentCarrier): boolean {
  const raw = request.cookies.get(CONSENT_COOKIE_NAME)?.value;
  return hasConsent(parseConsent(raw), "analytics");
}

export type FunnelEventRow = {
  name: FunnelEventName;
  anonId?: string | null;
  userId?: string | null;
  path?: string | null;
  properties?: FunnelProperties;
};

/**
 * Inserts already-validated rows. Callers must have checked consent.
 *
 * `return=minimal` because nothing reads the result and the row ids are of no
 * use to anyone.
 */
export async function insertFunnelEvents(rows: FunnelEventRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  await supabaseRequest<unknown>(ANALYTICS_EVENTS_TABLE, {
    method: "POST",
    prefer: "return=minimal",
    body: rows.map((row) => ({
      name: row.name,
      origin: FUNNEL_EVENT_SPECS[row.name].origin,
      anon_id: row.anonId ?? null,
      user_id: row.userId ?? null,
      path: row.path ?? null,
      properties: row.properties ?? {}
    }))
  });
}

/**
 * Records one server-side funnel event for a signed-in user.
 *
 * Fire-and-forget by design: a funnel is never a reason for a sign-up, a broker
 * connection or a quant run to fail, so every call site does `void
 * recordFunnelEvent(...)` and the promise swallows its own errors. Property
 * validation runs here too, so a typo at a call site is dropped rather than
 * stored as a column nothing can query.
 */
export async function recordFunnelEvent(
  request: ConsentCarrier,
  name: FunnelEventName,
  input: {
    userId: string;
    path?: string | null;
    properties?: Record<string, string | number | null | undefined>;
  }
): Promise<void> {
  try {
    if (!analyticsAllowed(request)) {
      return;
    }
    await insertFunnelEvents([
      {
        name,
        userId: input.userId,
        path: input.path ?? null,
        properties: sanitiseProperties(name, input.properties)
      }
    ]);
  } catch {
    /* Measurement must never break the thing being measured. */
  }
}

export const DEFAULT_ANALYTICS_RETENTION_DAYS = 180;

export function analyticsRetentionDays(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.ANALYTICS_RETENTION_DAYS ?? String(DEFAULT_ANALYTICS_RETENTION_DAYS));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ANALYTICS_RETENTION_DAYS;
}

/**
 * Deletes funnel rows past the retention window.
 *
 * Stated in `app/lib/legal/retention.ts`, which is the thing users read, so this
 * function existing is what makes that statement true. Rides the job worker's
 * cleanup sweep.
 */
export async function pruneOldFunnelEvents(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - analyticsRetentionDays() * 24 * 60 * 60 * 1000).toISOString();
  const deleted = await supabaseRequest<Array<{ id: string }>>(ANALYTICS_EVENTS_TABLE, {
    method: "DELETE",
    query: { created_at: lt(cutoff), select: "id" },
    prefer: "return=representation"
  });
  return deleted.length;
}
