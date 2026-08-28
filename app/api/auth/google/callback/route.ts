import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedSession,
  getSessionCookieMaxAge,
  issueSessionToken,
  SESSION_COOKIE_NAME
} from "@/app/lib/auth/session";
import {
  exchangeCodeForIdToken,
  GoogleAuthError,
  GOOGLE_NONCE_COOKIE,
  GOOGLE_PKCE_COOKIE,
  GOOGLE_STATE_COOKIE,
  parseGoogleState,
  sanitizeNextPath,
  verifyGoogleIdToken,
  type GoogleFlowMode
} from "@/app/lib/auth/google";
import { AccountIdentityError, findOrCreateUserForGoogle, linkGoogleToUser } from "@/app/lib/auth/users";
import { recordEvent } from "@/app/lib/db/events";
import { recordFunnelEvent } from "@/app/lib/analytics/funnel-store";
import { log } from "@/app/lib/observability/log";

const OAUTH_COOKIES = [GOOGLE_STATE_COOKIE, GOOGLE_PKCE_COOKIE, GOOGLE_NONCE_COOKIE];

function clearOAuthCookies(response: NextResponse) {
  for (const name of OAUTH_COOKIES) {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/api/auth/google",
      maxAge: 0
    });
  }
}

/**
 * Where a failure lands. A sign-in goes back to the login form; a link goes back
 * to the settings page it started from, because the user is signed in already
 * and has nothing to sign in to.
 */
function failure(request: NextRequest, code: string, nextPath: string, mode: GoogleFlowMode): NextResponse {
  const url = new URL(mode === "link" ? nextPath : "/auth/login", request.url);
  url.searchParams.set("googleError", code);
  if (mode !== "link" && nextPath !== "/dashboard") {
    url.searchParams.set("next", nextPath);
  }
  const response = NextResponse.redirect(url);
  clearOAuthCookies(response);
  return response;
}

export async function GET(request: NextRequest) {
  const code = (request.nextUrl.searchParams.get("code") ?? "").trim();
  const state = (request.nextUrl.searchParams.get("state") ?? "").trim();
  const oauthError = (request.nextUrl.searchParams.get("error") ?? "").trim();

  // The state cookie is the only trustworthy source for `next` and the flow mode
  // before the state parameter has been validated, so error paths before that
  // point fall back to the sign-in defaults.
  let nextPath = "/dashboard";
  let mode: GoogleFlowMode = "signin";

  if (oauthError) {
    // Includes the ordinary "user clicked Cancel" case (access_denied).
    return failure(request, oauthError, nextPath, mode);
  }
  if (!code || !state) {
    return failure(request, "missing_oauth_params", nextPath, mode);
  }

  try {
    const stateCookie = request.cookies.get(GOOGLE_STATE_COOKIE)?.value ?? "";
    if (!stateCookie || stateCookie !== state) {
      throw new GoogleAuthError("invalid_state", "Google OAuth state did not match the state cookie");
    }

    const payload = parseGoogleState(state);
    nextPath = sanitizeNextPath(payload.nextPath);
    mode = payload.mode;

    const codeVerifier = request.cookies.get(GOOGLE_PKCE_COOKIE)?.value ?? "";
    if (!codeVerifier) {
      throw new GoogleAuthError("missing_verifier", "Missing Google OAuth PKCE verifier");
    }
    const expectedNonce = request.cookies.get(GOOGLE_NONCE_COOKIE)?.value ?? "";
    if (!expectedNonce) {
      throw new GoogleAuthError("missing_nonce", "Missing Google OAuth nonce");
    }

    const idToken = await exchangeCodeForIdToken({ code, codeVerifier, request });
    const identity = verifyGoogleIdToken(idToken, expectedNonce);

    if (!identity.emailVerified) {
      // Without a verified email we cannot safely link to, or create, an account
      // keyed on that address.
      throw new GoogleAuthError("email_not_verified", "Google account email is not verified");
    }

    if (mode === "link") {
      return await completeLink({ request, identity, nextPath, linkUserId: payload.linkUserId });
    }

    const { user, outcome } = await findOrCreateUserForGoogle({ sub: identity.sub, email: identity.email });

    const token = await issueSessionToken(user);

    const response = NextResponse.redirect(new URL(nextPath, request.url));
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: getSessionCookieMaxAge()
    });
    clearOAuthCookies(response);

    void recordEvent({
      userId: user.id,
      action: "login",
      status: "success",
      metadata: { email: user.email, provider: "google", outcome }
    }).catch(() => {});

    // `outcome` is what separates a sign-up from a sign-in on this route: only
    // "created" is a new account. "linked" is an existing password account
    // gaining a Google identity, and counting it as a signup would inflate the
    // metric with people who were already customers.
    if (outcome === "created") {
      void recordFunnelEvent(request, "signup_complete", {
        userId: user.id,
        properties: { method: "google" }
      });
    }
    void recordFunnelEvent(request, "session_start", {
      userId: user.id,
      properties: { method: "google" }
    });

    return response;
  } catch (error) {
    const errorCode = error instanceof GoogleAuthError ? error.code : "google_signin_failed";
    // No user id to attribute this to, so it goes to the log rather than the
    // per-user events table.
    log.warn("auth.google.signin_failed", {
      code: errorCode,
      mode,
      error: error instanceof Error ? error.message : String(error)
    });
    return failure(request, errorCode, nextPath, mode);
  }
}

/**
 * The `?mode=link` half: attach this Google identity to the account already in
 * session and mint nothing. No session is issued and none is revoked — the user
 * has not changed, only the ways they can get back in.
 *
 * The session is re-read here rather than trusted from the state: the state
 * proves which account *started* the link, and this checks the same account is
 * still the one signed in. A sign-out and sign-in as someone else mid-flow ends
 * up refused rather than linking Google to the wrong account.
 */
async function completeLink(input: {
  request: NextRequest;
  identity: { sub: string; email: string };
  nextPath: string;
  linkUserId: string | null;
}): Promise<NextResponse> {
  const session = await getAuthenticatedSession(input.request);
  if (!session || !input.linkUserId || session.userId !== input.linkUserId) {
    return failure(input.request, "link_session_mismatch", input.nextPath, "link");
  }

  let outcome: string;
  try {
    outcome = await linkGoogleToUser({
      userId: session.userId,
      sub: input.identity.sub,
      email: input.identity.email
    });
  } catch (error) {
    if (error instanceof AccountIdentityError) {
      return failure(input.request, error.code, input.nextPath, "link");
    }
    log.warn("auth.google.link_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return failure(input.request, "google_link_failed", input.nextPath, "link");
  }

  void recordEvent({
    userId: session.userId,
    action: "account_google_link",
    status: "success",
    metadata: { outcome }
  }).catch(() => {});

  const url = new URL(input.nextPath, input.request.url);
  url.searchParams.set("googleLinked", "1");
  const response = NextResponse.redirect(url);
  clearOAuthCookies(response);
  return response;
}
