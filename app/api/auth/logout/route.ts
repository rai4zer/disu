import { NextRequest, NextResponse } from "next/server";
import { endSessionForRequest, SESSION_COOKIE_NAME } from "@/app/lib/auth/session";

export async function POST(request: NextRequest) {
  // Clearing the cookie only removes the browser's copy. Revoking the session
  // row is what stops the token itself from working — it would otherwise stay
  // valid for the rest of its seven days in anyone else's hands.
  await endSessionForRequest(request, "signed_out").catch(() => {
    // A failure here must not leave the user staring at a sign-out that did
    // nothing visible; the cookie is cleared regardless and the session expires
    // on its own schedule.
  });

  const response = NextResponse.json({ ok: true });
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
