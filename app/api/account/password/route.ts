import { NextRequest, NextResponse } from "next/server";
import { PasswordPolicyError } from "@/app/lib/auth/password-policy";
import {
  getSessionCookieMaxAge,
  getAuthenticatedSession,
  issueSessionToken,
  SESSION_COOKIE_NAME
} from "@/app/lib/auth/session";
import { revokeAllSessionsForUser } from "@/app/lib/auth/sessions";
import { AccountIdentityError, getAccountIdentity, setUserPassword, verifyUserPassword } from "@/app/lib/auth/users";
import { recordEvent } from "@/app/lib/db/events";
import { checkAuthRateLimit } from "@/app/lib/security/auth-rate-limit";
import { clientIpFromHeaders } from "@/app/lib/security/client-ip";
import { rateLimitedResponse } from "@/app/lib/security/rate-limit-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sets or changes the account password from inside a live session.
 *
 * This is what closes the Google gap (ROADMAP §2.3): a Google-only user could
 * previously only acquire a password by pretending to have forgotten one and
 * following the reset email, which is a strange thing to ask of someone who is
 * signed in and never had a password in the first place. Here the Google-issued
 * session *is* the authorisation, so no `currentPassword` is required — there is
 * none to give. An account that already has one must prove it, because a
 * borrowed laptop should not be able to change the password silently.
 *
 * Either way every other session is revoked and this browser is issued a fresh
 * one: a password change is the move someone makes when they suspect a leak, so
 * leaving the other cookies alive would defeat it, and signing the *current*
 * browser out as collateral would be a poor way to confirm success.
 */
export async function POST(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const verdict = checkAuthRateLimit({
    route: "login",
    ip: clientIpFromHeaders(request.headers),
    email: session.email
  });
  if (!verdict.allowed) {
    return rateLimitedResponse(verdict);
  }

  const body = (await request.json().catch(() => ({}))) as {
    currentPassword?: string;
    newPassword?: string;
  };
  const newPassword = body.newPassword ?? "";

  const identity = await getAccountIdentity(session.userId);
  if (!identity) {
    return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 });
  }

  if (identity.hasPassword) {
    const reauthenticated = await verifyUserPassword(session.userId, body.currentPassword ?? "");
    if (!reauthenticated) {
      return NextResponse.json(
        { ok: false, error: "Current password is incorrect.", code: "reauth_failed" },
        { status: 401 }
      );
    }
  }

  try {
    await setUserPassword(session.userId, newPassword);
  } catch (error) {
    if (error instanceof PasswordPolicyError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 400 });
    }
    if (error instanceof AccountIdentityError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 400 });
    }
    console.error("Password change failed", error);
    return NextResponse.json({ ok: false, error: "Unable to update the password." }, { status: 500 });
  }

  const revoked = await revokeAllSessionsForUser(session.userId, "password_changed");
  const token = await issueSessionToken({ id: session.userId, email: session.email });

  void recordEvent({
    userId: session.userId,
    action: "account_password_set",
    status: "success",
    // `set` is the Google-only first password, `change` replaces an existing one.
    metadata: { mode: identity.hasPassword ? "change" : "set", revokedSessions: revoked }
  }).catch(() => {});

  const response = NextResponse.json({
    ok: true,
    hasPassword: true,
    /** Other devices that were signed out. This browser is not counted. */
    otherSessionsEnded: Math.max(0, revoked - 1)
  });
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
}
