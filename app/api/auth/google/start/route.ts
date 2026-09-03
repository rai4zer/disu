import { NextRequest, NextResponse } from "next/server";
import {
  buildGoogleAuthorizeUrl,
  createGoogleState,
  GoogleAuthError,
  GOOGLE_NONCE_COOKIE,
  GOOGLE_PKCE_COOKIE,
  GOOGLE_STATE_COOKIE,
  OAUTH_COOKIE_MAX_AGE_SECONDS,
  sanitizeNextPath,
  type GoogleFlowMode
} from "@/app/lib/auth/google";
import { getAuthenticatedSession } from "@/app/lib/auth/session";

export async function GET(request: NextRequest) {
  // `?mode=link` is the account-settings entry point: connect Google to the
  // account that is already signed in, rather than signing in with Google.
  const mode: GoogleFlowMode = request.nextUrl.searchParams.get("mode") === "link" ? "link" : "signin";
  const nextPath = sanitizeNextPath(request.nextUrl.searchParams.get("next") ?? (mode === "link" ? "/profile" : null));

  // The user id is captured now and baked into the signed state, so the callback
  // can refuse a link that started in one account and came back in another.
  let linkUserId: string | null = null;
  if (mode === "link") {
    const session = await getAuthenticatedSession(request);
    if (!session) {
      const loginUrl = new URL("/auth/login", request.url);
      loginUrl.searchParams.set("next", nextPath);
      return NextResponse.redirect(loginUrl);
    }
    linkUserId = session.userId;
  }

  try {
    const state = createGoogleState({ nextPath, mode, linkUserId });
    const handoff = buildGoogleAuthorizeUrl({ request, state });

    const response = NextResponse.redirect(handoff.url);
    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: request.nextUrl.protocol === "https:",
      // Scoped to the OAuth routes so these short-lived values are not attached
      // to every other request the app makes.
      path: "/api/auth/google",
      maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS
    };

    response.cookies.set(GOOGLE_STATE_COOKIE, state, cookieOptions);
    response.cookies.set(GOOGLE_PKCE_COOKIE, handoff.codeVerifier, cookieOptions);
    response.cookies.set(GOOGLE_NONCE_COOKIE, handoff.nonce, cookieOptions);

    return response;
  } catch (error) {
    const code = error instanceof GoogleAuthError ? error.code : "google_start_failed";
    // A failed link belongs back on the settings page, not on the login form —
    // the user is signed in and has nothing to sign in to.
    const url = new URL(mode === "link" ? nextPath : "/auth/login", request.url);
    url.searchParams.set("googleError", code);
    if (mode !== "link" && nextPath !== "/dashboard") {
      url.searchParams.set("next", nextPath);
    }
    return NextResponse.redirect(url);
  }
}
