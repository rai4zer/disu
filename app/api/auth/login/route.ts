import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/app/lib/auth/users";
import { createSessionToken, getSessionCookieMaxAge, SESSION_COOKIE_NAME } from "@/app/lib/auth/session";
import { recordEvent } from "@/app/lib/db/events";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";

  const user = await authenticateUser(email, password);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Invalid email or password." }, { status: 401 });
  }

  const token = createSessionToken({ userId: user.id, email: user.email });
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

  void recordEvent({
    userId: user.id,
    action: "login",
    status: "success",
    metadata: { email: user.email }
  }).catch(() => {});

  return response;
}
