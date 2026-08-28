/**
 * The single server-side gate every new password goes through: the local
 * policy (`password-policy.ts`) first, because it is free and catches the
 * predictable cases, then the breach corpus, which needs the network.
 *
 * Kept separate from `password-policy.ts` so that module stays importable from
 * a client component — this one pulls in `node:crypto` via the range client.
 */

import { PasswordPolicyError, checkPasswordShape } from "@/app/lib/auth/password-policy";
import { isPasswordBreached } from "@/app/lib/security/pwned-passwords";
import { log } from "@/app/lib/observability/log";

export async function assertAcceptablePassword(
  password: string,
  options: { email?: string; context: "register" | "reset" | "change" } = { context: "register" }
): Promise<void> {
  const verdict = checkPasswordShape(password, { email: options.email });
  if (!verdict.ok) {
    throw new PasswordPolicyError(verdict.code);
  }

  const breach = await isPasswordBreached(password);
  if (breach.breached) {
    // The count, never the password or a hash of it — this is what makes the
    // rejection rate measurable without logging a credential.
    log.info("auth.password_rejected.breached", { context: options.context, count: breach.count });
    throw new PasswordPolicyError("password_breached");
  }
}
