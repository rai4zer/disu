import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionTokenEdge } from "@/app/lib/auth/session-edge";

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

export async function middleware(request: NextRequest) {
  // Verify the signature, do not just look for the cookie: a hand-written
  // disu_session value would otherwise walk straight past this gate and render
  // the signed-in shell (the API handlers would still 401, but the app frame
  // should never have been served in the first place).
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const secret = process.env.DISU_SESSION_SECRET;
  const session = token && secret ? await verifySessionTokenEdge(token, secret) : null;
  if (session) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;
  if (isApiPath(pathname)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/auth/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Not the same list as PROTECTED_PREFIXES in app/components/app-shell.tsx:
  // that one decides which routes render inside the app frame, this one decides
  // which routes require a session. Several routes are in the first list and not
  // in this one, and they render the signed-out chrome.
  //
  // Public on purpose (ROADMAP §9.1, §9.8 — value before account):
  //   /help, /help/faq, /help/docs  — linked from the footer on signed-out pages
  //   /legal/*                      — must be readable before signing up
  //   /learn/*                      — static education pages, nothing user-specific
  //   /primers                      — browsable logged out; the run itself still
  //                                   needs an account, and the page says so
  //   /instrument/*                 — ROADMAP §4.6. The page is the logged-out
  //                                   value that earns a visit and a search
  //                                   ranking, so it is not gated *here* —
  //                                   /api/instruments redacts by session
  //                                   instead, and returns a smaller body to an
  //                                   anonymous reader rather than a 401. See
  //                                   app/lib/market/instrument-visibility.ts.
  //   /api/tickers/search           — search is how someone reaches those pages;
  //                                   gating it would gate the door to them
  // Only /help/release-notes is gated inside /help.
  matcher: [
    "/profile/:path*",
    "/account/:path*",
    "/dashboard/:path*",
    "/portfolio/:path*",
    "/quant/:path*",
    "/filings-primers/:path*",
    "/sentiment/:path*",
    "/placera/:path*",
    "/help/release-notes/:path*",
    "/api/brokers/:path*",
    "/api/portfolio/:path*",
    "/api/quant/:path*",
    "/api/filings-primers/:path*",
    "/api/jobs/:path*",
    "/api/account/:path*",
    "/api/release-notes/:path*"
  ]
};
