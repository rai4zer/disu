import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { eq, supabaseRequest } from "@/app/lib/db/supabase";
import { revokeAllSessionsForUser } from "@/app/lib/auth/sessions";
import { findUserByEmail } from "@/app/lib/auth/users";
import { assertAcceptablePassword } from "@/app/lib/auth/password-guard";
import { PasswordPolicyError, checkPasswordShape } from "@/app/lib/auth/password-policy";
import { log } from "@/app/lib/observability/log";

type PasswordResetTokenRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function getResetBaseUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";
}

async function sendResetEmail(email: string, resetUrl: string): Promise<void> {
  const from = (process.env.SYSTEM_FROM_EMAIL ?? process.env.WEEKLY_EMAIL_FROM ?? "").trim();
  const resendKey = (process.env.RESEND_API_KEY ?? "").trim();
  const provider = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();

  if (provider === "resend" && from && resendKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Reset your DISU password",
        text: `Use this link to reset your DISU password: ${resetUrl}`,
        html: `<p>Use this link to reset your DISU password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`resend password reset failed: HTTP ${response.status}${body ? ` ${body}` : ""}`);
    }
    return;
  }

  // Only production reaches this function, so an unconfigured provider here is
  // a misconfigured deployment, not a local convenience. Swallowing it into a
  // log line let the route answer "a reset link has been sent" while nothing
  // was ever sent — the failure then surfaced as a user waiting on an inbox.
  // Failing loudly costs one 500 and names the missing variable.
  const missing = [
    provider === "resend" ? null : "EMAIL_PROVIDER=resend",
    resendKey ? null : "RESEND_API_KEY",
    from ? null : "SYSTEM_FROM_EMAIL"
  ].filter(Boolean);

  log.error("auth.password_reset.provider_unconfigured", {
    to: email,
    missing,
    note: "Password reset email could not be sent: email provider not configured."
  });

  throw new Error(`Password reset email is not configured (missing: ${missing.join(", ")}).`);
}

export async function createPasswordResetForPrototype(email: string): Promise<string | null> {
  const user = await findUserByEmail(email);
  if (!user) {
    return null;
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString();

  await supabaseRequest<unknown[]>("password_reset_tokens", {
    method: "POST",
    body: [
      {
        id: `prt_${randomUUID()}`,
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt
      }
    ]
  });

  const resetUrl = `${getResetBaseUrl()}/auth/reset-password?token=${encodeURIComponent(token)}`;

  if (process.env.NODE_ENV === "production") {
    await sendResetEmail(user.email, resetUrl);
    return null;
  }

  log.info("auth.password_reset.prototype_link", {
    to: user.email,
    resetUrl
  });

  return resetUrl;
}

async function findResetToken(token: string): Promise<PasswordResetTokenRow | null> {
  const rows = await supabaseRequest<PasswordResetTokenRow[]>("password_reset_tokens", {
    query: {
      token_hash: eq(hashToken(token)),
      select: "id,user_id,token_hash,expires_at,used_at,created_at",
      limit: "1"
    }
  });
  return rows[0] ?? null;
}

export async function resetPasswordWithToken(token: string, password: string): Promise<void> {
  if (!token.trim()) {
    throw new Error("Invalid reset token.");
  }
  // The free half of the policy runs first, so an obviously weak password is
  // rejected without a query. No email to key the personal-data check on here
  // — the caller holds a token, not an address (§2.3).
  const shape = checkPasswordShape(password);
  if (!shape.ok) {
    throw new PasswordPolicyError(shape.code);
  }

  const record = await findResetToken(token);
  if (!record) {
    throw new Error("Invalid or expired reset link.");
  }
  if (record.used_at) {
    throw new Error("This reset link has already been used.");
  }
  if (Date.parse(record.expires_at) <= Date.now()) {
    throw new Error("This reset link has expired.");
  }

  // The breach lookup waits until the token has proved out: an outbound call
  // per anonymous POST would be a free amplification primitive.
  await assertAcceptablePassword(password, { context: "reset" });

  const salt = randomUUID();
  await supabaseRequest<unknown[]>("users", {
    method: "PATCH",
    query: {
      id: eq(record.user_id)
    },
    body: {
      password_hash: hashPassword(password, salt),
      password_salt: salt
    },
    prefer: "return=minimal"
  });

  await supabaseRequest<unknown[]>("password_reset_tokens", {
    method: "PATCH",
    query: {
      id: eq(record.id)
    },
    body: {
      used_at: new Date().toISOString()
    },
    prefer: "return=minimal"
  });

  // A password reset is the move someone makes when they think their account is
  // compromised, so it has to end every session that already exists — otherwise
  // the intruder keeps their cookie and the reset accomplishes nothing. Ordered
  // last so a failure here cannot leave the password unchanged.
  await revokeAllSessionsForUser(record.user_id, "password_reset");
}
