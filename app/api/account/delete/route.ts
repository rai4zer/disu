import { NextRequest, NextResponse } from "next/server";
import { AccountDeletionBlockedError, deleteAccount, findAccountDeletionBlockers } from "@/app/lib/account/delete";
import { getAuthenticatedSession, SESSION_COOKIE_NAME } from "@/app/lib/auth/session";
import { authenticateUser } from "@/app/lib/auth/users";
import { checkAuthRateLimit } from "@/app/lib/security/auth-rate-limit";
import { clientIpFromHeaders } from "@/app/lib/security/client-ip";
import { rateLimitedResponse } from "@/app/lib/security/rate-limit-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reports whether anything would refuse an erasure, so the UI can say so before
 * the person commits rather than after.
 */
export async function GET(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const blockers = await findAccountDeletionBlockers(session.userId);
  return NextResponse.json({
    ok: true,
    canDelete: blockers.length === 0,
    blockers: blockers.map((blocker) => ({
      table: blocker.table,
      rowCount: blocker.rowCount,
      reason: blocker.reason
    }))
  });
}

/**
 * GDPR Art. 17 — erasure. Irreversible, so it asks for the password again.
 *
 * A session cookie alone is not enough authorization to destroy an account: a
 * borrowed laptop or a stolen cookie should not be able to do this. Accounts
 * with no password (Google-only) are still refused rather than given a weaker
 * path, but that is no longer a dead end: /account sets a password in-session,
 * so the route back is two steps rather than a password-reset email (§2.3).
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

  const body = (await request.json().catch(() => ({}))) as { password?: string; confirm?: string };

  // A deliberate second step, not decoration: a mis-click cannot reach this.
  if (body.confirm !== "DELETE") {
    return NextResponse.json(
      { ok: false, error: 'Confirmation required. Send {"confirm":"DELETE"} to proceed.', code: "confirmation_required" },
      { status: 400 }
    );
  }

  const reauthenticated = await authenticateUser(session.email, body.password ?? "");
  if (!reauthenticated || reauthenticated.id !== session.userId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Password is incorrect, or this account has no password set. Set one under Account first.",
        code: "reauth_failed"
      },
      { status: 401 }
    );
  }

  try {
    const result = await deleteAccount(session.userId);

    // Every session row went with the account, so the token is already dead —
    // clearing the cookie just stops the browser presenting a corpse.
    const response = NextResponse.json({
      ok: true,
      deletedAt: result.deletedAt,
      erased: result.erased,
      anonymised: result.anonymised
    });
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0
    });
    return response;
  } catch (error) {
    if (error instanceof AccountDeletionBlockedError) {
      return NextResponse.json(
        {
          ok: false,
          error: "This account cannot be erased automatically.",
          code: "deletion_blocked",
          blockers: error.blockers.map((blocker) => ({
            table: blocker.table,
            rowCount: blocker.rowCount,
            reason: blocker.reason
          }))
        },
        { status: 409 }
      );
    }
    console.error("Account deletion failed", error);
    return NextResponse.json({ ok: false, error: "Unable to delete the account." }, { status: 500 });
  }
}
