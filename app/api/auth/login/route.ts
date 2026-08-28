import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/app/lib/auth/users";
import { getSessionCookieMaxAge, issueSessionToken, SESSION_COOKIE_NAME } from "@/app/lib/auth/session";
import { recordEvent } from "@/app/lib/db/events";
import { recordFunnelEvent } from "@/app/lib/analytics/funnel-store";
import { checkAuthRateLimit, clearAuthRateLimitForSubject } from "@/app/lib/security/auth-rate-limit";
import { clientIpFromHeaders } from "@/app/lib/security/client-ip";
import { rateLimitedResponse } from "@/app/lib/security/rate-limit-response";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";

  const verdict = checkAuthRateLimit({
    route: "login",
    ip: clientIpFromHeaders(request.headers),
    email
  });
  if (!verdict.allowed) {
    return rateLimitedResponse(verdict);
  }

  const user = await authenticateUser(email, password);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Invalid email or password." }, { status: 401 });
  }

  // Proving you own the account releases its bucket, so a run of typos does not
  // keep throttling you once you get the password right.
  clearAuthRateLimitForSubject("login", user.email);

  const token = await issueSessionToken(user);
  const response = NextResponse.json({ ok: true, user });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getSessionCookieMaxAge()
  });

  void recordEvent({
    userId: user.id,
    action: "login",
    status: "success",
    metadata: { email: user.email }
  }).catch(() => {});

  // The same sign-in, counted twice on purpose: the line above is the audit
  // record of who used this account, held under legitimate interest, and this
  // one is a funnel step held under consent. Different bases, different tables,
  // different retention — see app/lib/analytics/funnel.ts.
  void recordFunnelEvent(request, "session_start", {
    userId: user.id,
    properties: { method: "password" }
  });

  return response;
}
