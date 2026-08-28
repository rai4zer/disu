import { NextResponse } from "next/server";
import type { AuthRateLimitVerdict } from "@/app/lib/security/auth-rate-limit";

/**
 * The 429 every throttled auth route returns.
 *
 * The body says the same thing whichever bucket ran out: telling a caller
 * *which* limit they hit leaks whether an email is being targeted, and the
 * distinction is useless to a legitimate user anyway.
 */
export function rateLimitedResponse(verdict: AuthRateLimitVerdict): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: "Too many attempts. Please wait a moment and try again.",
      code: "rate_limited",
      retryAfterSeconds: verdict.retryAfterSeconds
    },
    {
      status: 429,
      headers: { "Retry-After": String(verdict.retryAfterSeconds) }
    }
  );
}
