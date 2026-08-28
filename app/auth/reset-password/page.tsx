"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import MarketStrip from "@/app/components/market-strip";
import { useLanguage } from "@/app/i18n/language";
import {
  PASSWORD_MESSAGES,
  PASSWORD_MIN_LENGTH,
  checkPasswordShape,
  passwordPolicyMessage,
  type PasswordRejectionCode
} from "@/app/lib/auth/password-policy";
import styles from "../login/page.module.css";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!token) {
      setError(isSv ? "Ogiltig återställningslänk." : "Invalid reset link.");
      return;
    }
    // Same policy the server enforces (§2.3), run locally so the predictable
    // rejections are instant.
    const verdict = checkPasswordShape(password);
    if (!verdict.ok) {
      setError(passwordPolicyMessage(verdict.code, isSv ? "sv" : "en"));
      return;
    }
    if (password !== confirmPassword) {
      setError(isSv ? "Lösenorden matchar inte." : "Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password })
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; code?: string };
      if (!response.ok || !payload.ok) {
        const fallback = payload.error ?? (isSv ? "Kunde inte återställa lösenordet." : "Could not reset password.");
        setError(
          payload.code && payload.code in PASSWORD_MESSAGES
            ? passwordPolicyMessage(payload.code as PasswordRejectionCode, isSv ? "sv" : "en")
            : fallback
        );
        return;
      }
      setNotice(isSv ? "Lösenordet har uppdaterats. Du kan nu logga in." : "Password updated. You can now sign in.");
      setTimeout(() => router.replace("/auth/login"), 1200);
    } catch {
      setError(isSv ? "Kunde inte återställa lösenordet." : "Could not reset password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <MarketStrip action="signin" />
      {/* Single centred column: heading, card and back-link all share one axis. */}
      <main className={styles.page}>
        <div className={`${styles.shell} ${styles.resetShell}`}>
          <h1 className={styles.heading}>{isSv ? "Välj nytt lösenord" : "Choose a new password"}</h1>

          <form className={styles.card} onSubmit={(event) => void handleSubmit(event)}>
            <label className={styles.field}>
              <span>{isSv ? "Nytt lösenord" : "New password"}</span>
              <input
                className={styles.input}
                type="password"
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={
                  isSv ? `Minst ${PASSWORD_MIN_LENGTH} tecken` : `At least ${PASSWORD_MIN_LENGTH} characters`
                }
                required
              />
            </label>

            <label className={styles.field}>
              <span>{isSv ? "Bekräfta lösenord" : "Confirm password"}</span>
              <input
                className={styles.input}
                type="password"
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder={isSv ? "Upprepa lösenordet" : "Repeat the password"}
                required
              />
            </label>

            <p className={styles.passwordHint}>
              {isSv
                ? `Minst ${PASSWORD_MIN_LENGTH} tecken, och inte ett lösenord som förekommer i en känd dataläcka. Några orelaterade ord fungerar bra.`
                : `At least ${PASSWORD_MIN_LENGTH} characters, and not one that appears in a known data breach. A few unrelated words works well.`}
            </p>

            {error ? <p className={styles.error}>{error}</p> : null}
            {notice ? <p className={styles.notice}>{notice}</p> : null}

            <button className={styles.primary} type="submit" disabled={busy}>
              {busy ? (isSv ? "Vänta..." : "Please wait...") : isSv ? "Uppdatera lösenord" : "Update password"}
            </button>
          </form>

          <p className={styles.backWrap}>
            <Link href="/auth/login">{isSv ? "← Till inloggning" : "← Back to sign in"}</Link>
          </p>
        </div>
      </main>
    </>
  );
}
