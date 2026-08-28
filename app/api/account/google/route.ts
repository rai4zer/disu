import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { AccountIdentityError, getAccountIdentity, unlinkGoogleFromUser } from "@/app/lib/auth/users";
import { recordEvent } from "@/app/lib/db/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Disconnects Google from the signed-in account (ROADMAP §2.3).
 *
 * Refused while it is the only way in — an account with no password and no
 * `google_sub` still has its email, so the person is not locked out forever, but
 * their only route back is the password-reset email, which is exactly the
 * indirection the settings page exists to remove.
 *
 * Linking is not a POST here: it is a full-page OAuth redirect, so it lives at
 * /api/auth/google/start?mode=link.
 */
export async function DELETE(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const identity = await getAccountIdentity(session.userId);
  if (!identity) {
    return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 });
  }
  if (!identity.googleLinked) {
    // Idempotent: the desired state already holds.
    return NextResponse.json({ ok: true, googleLinked: false });
  }

  try {
    await unlinkGoogleFromUser(session.userId);
  } catch (error) {
    if (error instanceof AccountIdentityError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.code === "password_required" ? 409 : 400 }
      );
    }
    console.error("Google unlink failed", error);
    return NextResponse.json({ ok: false, error: "Unable to disconnect Google." }, { status: 500 });
  }

  void recordEvent({
    userId: session.userId,
    action: "account_google_unlink",
    status: "success"
  }).catch(() => {});

  return NextResponse.json({ ok: true, googleLinked: false });
}
