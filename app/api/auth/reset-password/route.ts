import { NextRequest, NextResponse } from "next/server";
import { resetPasswordWithToken } from "@/app/lib/auth/reset";
import { PasswordPolicyError } from "@/app/lib/auth/password-policy";
import { checkAuthRateLimit } from "@/app/lib/security/auth-rate-limit";
import { clientIpFromHeaders } from "@/app/lib/security/client-ip";
import { rateLimitedResponse } from "@/app/lib/security/rate-limit-response";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { token?: string; password?: string };
  const token = body.token?.trim() ?? "";
  const password = body.password ?? "";

  // No email to key on here — the IP bucket is what bounds guessing at the
  // reset token itself.
  const verdict = checkAuthRateLimit({
    route: "reset-password",
    ip: clientIpFromHeaders(request.headers)
  });
  if (!verdict.allowed) {
    return rateLimitedResponse(verdict);
  }

  try {
    await resetPasswordWithToken(token, password);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reset password.";
    const code = error instanceof PasswordPolicyError ? error.code : undefined;
    return NextResponse.json({ ok: false, error: message, code }, { status: 400 });
  }
}
