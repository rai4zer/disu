"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./page.module.css";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";

type AuthMode = "login" | "register";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") || "/dashboard", [searchParams]);

  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function checkSession() {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!cancelled && response.ok) {
        router.replace(nextPath);
      }
    }
    void checkSession();
    return () => {
      cancelled = true;
    };
  }, [nextPath, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password
        })
      });

      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? (isSv ? "Autentisering misslyckades." : "Authentication failed."));
        return;
      }

      router.replace(nextPath);
    } catch {
      setError(isSv ? "Kunde inte slutföra autentisering. Försök igen." : "Could not complete authentication. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={mode === "login" ? (isSv ? "Logga in i DISU" : "Sign in to DISU") : isSv ? "Skapa ditt DISU-konto" : "Create your DISU account"}
        subtitle={
          isSv
            ? "Mäklaranslutningar konfigureras inne i plattformen efter inloggning."
            : "Broker connections are configured inside the platform after login."
        }
        size="narrow"
      >
        <p className={styles.kicker}>{isSv ? "DISU-konto" : "DISU account"}</p>

        <div className={styles.switch}>
          <button
            type="button"
            onClick={() => setMode("login")}
            className={mode === "login" ? styles.switchActive : styles.switchBtn}
          >
            {isSv ? "Logga in" : "Sign In"}
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={mode === "register" ? styles.switchActive : styles.switchBtn}
          >
            {isSv ? "Skapa konto" : "Create Account"}
          </button>
        </div>

        <form className={`${styles.card} appForm appSection`} onSubmit={(event) => void handleSubmit(event)}>
          <label className={`${styles.field} appField`}>
            <span>Email</span>
            <input
              className="appInput"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              required
            />
          </label>

          <label className={`${styles.field} appField`}>
            <span>{isSv ? "Lösenord" : "Password"}</span>
            <input
              className="appInput"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={isSv ? "Minst 8 tecken" : "At least 8 characters"}
              required
            />
          </label>

          {error ? <p className={`${styles.error} appError`}>{error}</p> : null}

          <button className={`${styles.primary} appButton`} type="submit" disabled={busy}>
            {busy ? (isSv ? "Vänta..." : "Please wait...") : mode === "login" ? (isSv ? "Logga in" : "Sign in") : isSv ? "Skapa konto" : "Create account"}
          </button>
        </form>

        <p className={styles.backWrap}>
          <Link href="/">{isSv ? "← Till startsidan" : "← Back to homepage"}</Link>
        </p>
      </Workspace>
    </main>
  );
}
