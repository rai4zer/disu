import { NextRequest, NextResponse } from "next/server";
import { createUser } from "@/app/lib/auth/users";
import { PasswordPolicyError } from "@/app/lib/auth/password-policy";
import { getSessionCookieMaxAge, issueSessionToken, SESSION_COOKIE_NAME } from "@/app/lib/auth/session";
import { checkAuthRateLimit } from "@/app/lib/security/auth-rate-limit";
import { clientIpFromHeaders } from "@/app/lib/security/client-ip";
import { rateLimitedResponse } from "@/app/lib/security/rate-limit-response";
import { recordFunnelEvent } from "@/app/lib/analytics/funnel-store";

export async function POST(request: NextRequest) {
  // Parsed defensively and throttled before anything else: a malformed body must
  // still spend budget, or the limiter is trivially skipped by sending garbage.
  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";

  const verdict = checkAuthRateLimit({
    route: "register",
    ip: clientIpFromHeaders(request.headers),
    email
  });
  if (!verdict.allowed) {
    return rateLimitedResponse(verdict);
  }

  try {
    const user = await createUser(email, password);
    const token = await issueSessionToken(user);

    // The two funnel steps a sign-up produces. Recorded here rather than in the
    // form because this is the only place that knows an account actually exists —
    // and a client that could post signup_complete could forge the whole metric.
    void recordFunnelEvent(request, "signup_complete", {
      userId: user.id,
      properties: { method: "password" }
    });
    void recordFunnelEvent(request, "session_start", {
      userId: user.id,
      properties: { method: "password" }
    });

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

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create account.";
    // Password rejections carry a code so the form can render the reason in
    // the user's language rather than echoing this English string.
    const code = error instanceof PasswordPolicyError ? error.code : undefined;
    return NextResponse.json({ ok: false, error: message, code }, { status: 400 });
  }
}
