/**
 * Ingest for browser-side errors.
 *
 * `log.error()` already fans out to `ERROR_REPORT_WEBHOOK_URL`, but only from
 * the server — nothing that broke in the browser ever reached it. This route is
 * the missing half: the client posts what it caught, the server sanitises it
 * and puts it through the same sink, so a React render crash and a failed job
 * land in one place with one grouping key.
 *
 * Deliberately public. Most client errors worth seeing happen on the signed-out
 * pages — the landing page, the login form, the consent banner — and a route
 * that needed a session would be blind to exactly those. The session cookie is
 * still read when present, so a signed-in report carries its user id.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/app/lib/auth/session";
import { MAX_BODY_BYTES, normaliseClientErrorReport } from "@/app/lib/observability/client-error";
import { log } from "@/app/lib/observability/log";
import { clientIpFromHeaders } from "@/app/lib/security/client-ip";
import { consumeRateLimit } from "@/app/lib/security/rate-limit";

/**
 * Generous enough for a page that breaks in a loop for a second, tight enough
 * that one client cannot fill the alerting budget. The browser reporter caps
 * itself far below this; the limit is here for the clients that do not.
 */
const REPORT_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

/**
 * Every outcome is 204.
 *
 * A rejected report must look exactly like an accepted one: a client that
 * learns it was throttled or malformed is a client that retries, and a browser
 * retrying its own error reports is how one bug becomes an outage. Nothing here
 * is worth telling the page about — it has already crashed.
 */
function accepted(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export async function POST(request: NextRequest) {
  const verdict = consumeRateLimit(
    `client-error:${clientIpFromHeaders(request.headers)}`,
    REPORT_RATE_LIMIT
  );
  if (!verdict.allowed) {
    return accepted();
  }

  // `sendBeacon` sets its own content type, so the body is read as text and
  // parsed by hand rather than trusting `request.json()` to be given JSON.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return accepted();
  }

  const body = await request.text().catch(() => "");
  if (!body || body.length > MAX_BODY_BYTES) {
    return accepted();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return accepted();
  }

  const report = normaliseClientErrorReport(parsed);
  if (!report) {
    return accepted();
  }

  // Signature-only: this is a log line, not an authorization decision, and it
  // is not worth a database round trip on a route an unauthenticated visitor
  // can call. A revoked session still identifies who hit the bug.
  const session = getSessionFromRequest(request);

  log.error("client_error", {
    ...report,
    userId: session?.userId,
    // Browser and OS are what make a client-only bug reproducible. The IP is
    // not logged: it is personal data, and it is already in the access log of
    // whatever sits in front of this process.
    userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? undefined
  });

  return accepted();
}
