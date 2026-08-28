import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { isGoogleSignInConfigured } from "@/app/lib/auth/google";
import { getAccountIdentity } from "@/app/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which sign-in methods this account has, for the account-settings page.
 *
 * Booleans only — never the hash, the salt or the Google `sub`. The page needs
 * to know that a password exists, not what it is.
 */
export async function GET(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const identity = await getAccountIdentity(session.userId);
  if (!identity) {
    return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    email: identity.email,
    createdAt: identity.createdAt,
    hasPassword: identity.hasPassword,
    googleLinked: identity.googleLinked,
    // The OAuth client is not provisioned on every deployment, so the page hides
    // the connect button rather than offering one that redirects into an error.
    googleSignInConfigured: isGoogleSignInConfigured(),
    // Unlinking Google without a password would be a lockout, so the reason the
    // button is disabled comes from the server rather than being re-derived.
    canUnlinkGoogle: identity.googleLinked && identity.hasPassword
  });
}
