import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import {
  FUNNEL_EVENT_SPECS,
  MAX_EVENTS_PER_REQUEST,
  isAnonId,
  isFunnelEventName,
  normalisePath,
  sanitiseProperties
} from "@/app/lib/analytics/funnel";
import { analyticsAllowed, insertFunnelEvents, type FunnelEventRow } from "@/app/lib/analytics/funnel-store";
import { clientIpFromHeaders } from "@/app/lib/security/client-ip";
import { consumeRateLimit } from "@/app/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The anonymous-capable half of the funnel stream (ROADMAP §2.6).
 *
 * `recordEvent()` cannot serve this: it requires a user id, and the top of a
 * funnel is by definition people who do not have one. So this route exists, and
 * everything unusual about it follows from being both unauthenticated and a
 * write endpoint:
 *
 *  - **Consent first, before anything is parsed.** No agreement, no row, and the
 *    answer is read from the cookie on the server rather than trusted from the
 *    client — a bug in the client gate must not be able to start collecting.
 *  - **Only `origin: "client"` events.** A browser may post `landing_view` and
 *    `signup_start`. `signup_complete` is the number the funnel is judged on, so
 *    a client that could post it could forge the metric; the server records those.
 *  - **Rate limited by IP**, like every other unauthenticated route here. The
 *    limit is generous enough for a real session and useless for filling a table.
 *  - **204 whatever happens.** The caller is a beacon that cannot act on a reply,
 *    and a body that distinguishes "no consent" from "unknown event" would be a
 *    free oracle for probing. Malformed input is the one exception: a 400 there
 *    turns a silently-dead metric into an obvious bug during development.
 *
 * `sendBeacon` cannot set a content type or read a response, which is why the
 * body is parsed defensively rather than gated on a header.
 */

/** 120/min: page views plus form opens for a real visitor, nowhere near a bulk write. */
const FUNNEL_RATE_LIMIT = { limit: 120, windowMs: 60_000 };

const noContent = () => new NextResponse(null, { status: 204 });

export async function POST(request: NextRequest) {
  const verdict = consumeRateLimit(`funnel:${clientIpFromHeaders(request.headers)}`, FUNNEL_RATE_LIMIT);
  if (!verdict.allowed) {
    return new NextResponse(null, {
      status: 429,
      headers: { "Retry-After": String(verdict.retryAfterSeconds) }
    });
  }

  // Before the body is even read: nothing about this request is worth parsing if
  // no row may be written from it.
  if (!analyticsAllowed(request)) {
    return noContent();
  }

  const body = (await request.json().catch(() => null)) as
    | { anonId?: unknown; events?: unknown }
    | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Malformed body." }, { status: 400 });
  }

  const submitted = Array.isArray(body.events) ? body.events : [];
  if (submitted.length === 0) {
    return NextResponse.json({ ok: false, error: "No events submitted." }, { status: 400 });
  }
  if (submitted.length > MAX_EVENTS_PER_REQUEST) {
    return NextResponse.json({ ok: false, error: "Too many events in one request." }, { status: 400 });
  }

  const anonId = isAnonId(body.anonId) ? body.anonId : null;
  if (!anonId) {
    // Without an id the rows cannot be joined into a funnel, and the table's
    // check constraint would reject them for a signed-out visitor anyway.
    return NextResponse.json({ ok: false, error: "Missing or malformed anonId." }, { status: 400 });
  }

  const rows: FunnelEventRow[] = [];
  for (const candidate of submitted) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const event = candidate as { name?: unknown; path?: unknown; properties?: unknown };
    if (!isFunnelEventName(event.name)) {
      continue;
    }
    if (FUNNEL_EVENT_SPECS[event.name].origin !== "client") {
      continue;
    }
    rows.push({
      name: event.name,
      anonId,
      path: normalisePath(event.path),
      properties: sanitiseProperties(event.name, event.properties)
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: "No recordable events." }, { status: 400 });
  }

  // Attaching the user id when a session happens to be present is what joins the
  // anonymous half of the funnel to the signed-in half. It is not required: a
  // signed-out visitor is the normal case here, so the session is read
  // opportunistically and its absence is not an error.
  const session = await getAuthenticatedSession(request);

  try {
    await insertFunnelEvents(rows.map((row) => ({ ...row, userId: session?.userId ?? null })));
  } catch {
    // A dropped funnel event is not worth a visible failure on a public page.
  }

  return noContent();
}
