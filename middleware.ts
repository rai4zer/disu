import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "disu_session";

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

export function middleware(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (hasSession) {
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
  matcher: [
    "/dashboard/:path*",
    "/portfolio/:path*",
    "/quant/:path*",
    "/filings-primers/:path*",
    "/sentiment/:path*",
    "/placera/:path*",
    "/api/brokers/:path*",
    "/api/portfolio/:path*",
    "/api/quant/:path*",
    "/api/filings-primers/:path*",
    "/api/jobs/:path*"
  ]
};
