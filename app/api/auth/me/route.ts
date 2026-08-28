import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession, SESSION_COOKIE_NAME } from "@/app/lib/auth/session";

export async function GET(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    const response = NextResponse.json({ authenticated: false }, { status: 401 });
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
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: session.userId,
      email: session.email
    }
  });
}
