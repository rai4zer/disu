import { NextRequest, NextResponse } from "next/server";
import { createPasswordResetForPrototype } from "@/app/lib/auth/reset";
import { checkAuthRateLimit } from "@/app/lib/security/auth-rate-limit";
import { clientIpFromHeaders } from "@/app/lib/security/client-ip";
import { rateLimitedResponse } from "@/app/lib/security/rate-limit-response";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const email = body.email?.trim() ?? "";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: false, error: "Invalid email." }, { status: 400 });
  }

  // Throttled after validation so malformed input cannot burn a real caller's
  // budget, but before the send: each accepted request costs an outbound email.
  const verdict = checkAuthRateLimit({
    route: "forgot-password",
    ip: clientIpFromHeaders(request.headers),
    email
  });
  if (!verdict.allowed) {
    return rateLimitedResponse(verdict);
  }

  try {
    const resetUrl = await createPasswordResetForPrototype(email);
    // `resetUrl` comes back populated only outside production, where nothing is
    // mailed and the link is handed straight to the page instead. Saying an
    // email is on its way there sends the caller to watch an inbox that will
    // never fill, so the client is told which of the two actually happened
    // rather than a fixed sentence that is false half the time.
    return NextResponse.json({
      ok: true,
      emailSent: resetUrl === null,
      resetUrl
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process password reset request.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
