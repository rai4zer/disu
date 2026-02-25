import { NextRequest, NextResponse } from "next/server";
import { createUser } from "@/app/lib/auth/users";
import { createSessionToken, getSessionCookieMaxAge, SESSION_COOKIE_NAME } from "@/app/lib/auth/session";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = body.email?.trim() ?? "";
    const password = body.password ?? "";

    const user = await createUser(email, password);
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

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create account.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
