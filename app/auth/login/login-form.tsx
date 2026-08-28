"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./page.module.css";
import MarketStrip from "@/app/components/market-strip";
import { useLanguage } from "@/app/i18n/language";
import { useFunnelEvent, useFunnelTracker } from "@/app/lib/analytics/track";
import {
  PASSWORD_MESSAGES,
  PASSWORD_MIN_LENGTH,
  checkPasswordShape,
  passwordPolicyMessage,
  type PasswordRejectionCode
} from "@/app/lib/auth/password-policy";

type Props = {
  googleEnabled: boolean;
};

/**
 * Maps the `?googleError=` slug set by /api/auth/google/callback onto copy. The
 * slugs are either our own GoogleAuthError codes or an OAuth error passed
 * straight through by Google (`access_denied` when the user cancels).
 */
function googleErrorMessage(code: string, isSv: boolean): string {
  switch (code) {
    case "access_denied":
      return isSv ? "Google-inloggningen avbröts." : "Google sign-in was cancelled.";
    case "google_not_configured":
      return isSv ? "Google-inloggning är inte tillgänglig just nu." : "Google sign-in is not available right now.";
    case "email_not_verified":
      return isSv
        ? "Din Google-adress är inte verifierad. Verifiera den hos Google och försök igen."
        : "Your Google email address is not verified. Verify it with Google and try again.";
    case "email_missing":
      return isSv
        ? "Google delade ingen e-postadress. Tillåt e-postbehörigheten och försök igen."
        : "Google did not share an email address. Allow the email permission and try again.";
    case "expired_state":
    case "invalid_state":
    case "missing_nonce":
    case "missing_verifier":
    case "missing_oauth_params":
      return isSv
        ? "Google-inloggningen tog för lång tid eller avbröts. Försök igen."
        : "The Google sign-in expired or was interrupted. Try again.";
    default:
      return isSv ? "Kunde inte logga in med Google. Försök igen." : "Could not sign in with Google. Try again.";
  }
}

/**
 * Password rejections come back as a stable `code` (§2.3) so the reason can be
 * shown in the user's language; the English `error` string is the fallback for
 * anything else the route rejects.
 */
function passwordErrorMessage(code: string | undefined, fallback: string, isSv: boolean): string {
  if (code && code in PASSWORD_MESSAGES) {
    return passwordPolicyMessage(code as PasswordRejectionCode, isSv ? "sv" : "en");
  }
  return fallback;
}

export default function LoginForm({ googleEnabled }: Props) {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") || "/dashboard", [searchParams]);
  // ?mode=register lets the landing-page sign-up CTA open the form directly.
  const initialMode = searchParams.get("mode") === "register" ? "register" : "login";
  const googleError = searchParams.get("googleError");

  const [mode, setMode] = useState<"login" | "register" | "forgot">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const trackFunnel = useFunnelTracker();

  // signup_start, the near half of the funnel's biggest drop-off. Fired when the
  // sign-up form is actually on screen — on arrival via ?mode=register as well as
  // on a switch from the sign-in form, because both are someone deciding to
  // create an account. `resetKey: mode` makes it once per entry into register
  // mode rather than once per keystroke, and the hook still fires it if consent
  // arrives from the banner after the form was already open.
  useFunnelEvent("signup_start", { method: "password" }, { when: mode === "register", resetKey: mode });

  useEffect(() => {
    let cancelled = false;
    async function checkSession() {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!cancelled && response.ok) {
        router.replace(nextPath);
        router.refresh();
      }
    }
    void checkSession();
    return () => {
      cancelled = true;
    };
  }, [nextPath, router]);

  function switchMode(next: "login" | "register" | "forgot") {
    setMode(next);
    setError(null);
    setNotice(null);
    setResetUrl(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setResetUrl(null);

    try {
      if (mode === "forgot") {
        const response = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          error?: string;
          emailSent?: boolean;
          resetUrl?: string | null;
        };
        if (!response.ok || !payload.ok) {
          setError(payload.error ?? (isSv ? "Kunde inte skicka återställningslänk." : "Could not send reset link."));
          return;
        }
        // Phrased here rather than taken from the server so both languages stay
        // available; the server reports which thing happened, not the sentence.
        setNotice(
          payload.emailSent === false
            ? isSv
              ? "Utvecklingsbygge: inget e-postmeddelande skickades. Använd länken nedan."
              : "Dev build: no email was sent. Use the reset link below."
            : isSv
              ? "Om kontot finns har en återställningslänk skickats."
              : "If an account exists for this email, a reset link has been sent."
        );
        setResetUrl(payload.resetUrl ?? null);
        return;
      }

      // Screened locally first so the common rejections are instant and cost
      // no request; the server runs the same check plus the breach lookup.
      if (mode === "register") {
        const verdict = checkPasswordShape(password, { email });
        if (!verdict.ok) {
          setError(passwordPolicyMessage(verdict.code, isSv ? "sv" : "en"));
          return;
        }
      }

      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      const payload = (await response.json()) as { ok?: boolean; error?: string; code?: string };
      if (!response.ok || !payload.ok) {
        const fallback = payload.error ?? (isSv ? "Autentisering misslyckades." : "Authentication failed.");
        setError(passwordErrorMessage(payload.code, fallback, isSv));
        return;
      }

      router.replace(nextPath);
      // The root layout resolves `signedIn` on the server, but a client-side
      // navigation reuses the cached RSC payload for shared layouts — so the
      // layout that renders is the one computed *before* this request set the
      // cookie. Without this refresh the app lands on /dashboard wearing the
      // signed-out chrome: "Skapa konto" in the nav, no module rail, while the
      // page's own client fetches return real data because the cookie is fine.
      // Sign-out already does this (components/logout-button.tsx); sign-in was
      // the missing half.
      router.refresh();
    } catch {
      setError(
        mode === "forgot"
          ? isSv
            ? "Kunde inte skicka återställningslänk. Försök igen."
            : "Could not send reset link. Try again."
          : isSv
            ? "Kunde inte slutföra autentisering. Försök igen."
            : "Could not complete authentication. Try again."
      );
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === "login"
      ? isSv
        ? "Logga in"
        : "Sign in"
      : mode === "register"
        ? isSv
          ? "Skapa konto"
          : "Create account"
        : isSv
          ? "Återställ lösenord"
          : "Reset password";

  const submitLabel = busy
    ? isSv
      ? "Väntar..."
      : "Please wait..."
    : mode === "login"
      ? isSv
        ? "Logga in"
        : "Sign in"
      : mode === "register"
        ? isSv
          ? "Skapa konto"
          : "Create account"
        : isSv
          ? "Skicka länk"
          : "Send link";

  // Google sign-in both signs in and signs up, so it is offered on either form.
  const showGoogle = googleEnabled && mode !== "forgot";
  const googleLabel =
    mode === "register"
      ? isSv
        ? "Fortsätt med Google"
        : "Continue with Google"
      : isSv
        ? "Logga in med Google"
        : "Sign in with Google";
  const googleHref = `/api/auth/google/start?next=${encodeURIComponent(nextPath)}`;

  return (
    <>
      <MarketStrip action="signin" />
      <main className={styles.page}>
      <div className={styles.shell}>
        <h1 className={styles.heading}>{heading}</h1>

        {googleError && <p className={styles.googleError}>{googleErrorMessage(googleError, isSv)}</p>}

        {showGoogle && (
          <>
            {/* A plain link, not fetch(): the OAuth flow is a full-page redirect
                to accounts.google.com and back. */}
            <a
              className={styles.googleButton}
              href={googleHref}
              onClick={() => {
                // Only from the sign-up form. The same button signs existing
                // users in, and counting those as sign-up starts would make the
                // form's conversion rate meaningless.
                if (mode === "register") {
                  trackFunnel("signup_start", { method: "google" });
                }
              }}
            >
              <GoogleMark />
              <span>{googleLabel}</span>
            </a>
            <div className={styles.divider}>
              <span>{isSv ? "eller" : "or"}</span>
            </div>
          </>
        )}

        <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
          <input
            id="email"
            className={styles.input}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
          />

          {mode !== "forgot" && (
            <input
              id="password"
              className={styles.input}
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              // Only the new-password path carries the floor: an existing
              // account created under the old 8-character rule must still be
              // able to type its password in.
              minLength={mode === "register" ? PASSWORD_MIN_LENGTH : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSv ? "Lösenord" : "Password"}
              required
            />
          )}

          {error && <p className={styles.error}>{error}</p>}
          {notice && <p className={styles.notice}>{notice}</p>}
          {resetUrl && (
            <p className={styles.notice}>
              <a href={resetUrl} className={styles.resetLink}>
                {isSv ? "Öppna återställningslänk" : "Open reset link"}
              </a>
            </p>
          )}

          <button className={styles.submit} type="submit" disabled={busy}>
            {submitLabel}
          </button>
        </form>

        {/* Shown wherever an account can be created — the password form in
            register mode, and the Google button, which creates one too. Kept to
            one line, and never a checkbox: consent to terms is not the ePrivacy
            kind of consent, and an extra click here costs activation (§9.3). */}
        {(mode === "register" || showGoogle) && (
          <p className={styles.consent}>
            {isSv ? "När du skapar ett konto godkänner du våra " : "By creating an account you agree to our "}
            <Link href="/legal/terms" className={styles.consentLink}>
              {isSv ? "användarvillkor" : "terms"}
            </Link>
            {isSv ? " och vår " : " and "}
            <Link href="/legal/privacy" className={styles.consentLink}>
              {isSv ? "integritetspolicy" : "privacy policy"}
            </Link>
            {isSv
              ? ". DISU ger information, inte investeringsrådgivning, och håller aldrig dina pengar."
              : ". DISU provides information, not investment advice, and never holds your money."}
          </p>
        )}

        <div className={styles.footer}>
          {mode === "login" && (
            <div className={styles.footerRow}>
              <p className={styles.footerText}>
                {isSv ? "Inget konto? " : "No account? "}
                <button type="button" className={styles.footerLinkUnderline} onClick={() => switchMode("register")}>
                  {isSv ? "Skapa ett" : "Create one"}
                </button>
              </p>
              <button type="button" className={styles.forgotLink} onClick={() => switchMode("forgot")}>
                {isSv ? "Glömt lösenord?" : "Forgot password?"}
              </button>
            </div>
          )}
          {mode === "register" && (
            <p className={styles.footerText}>
              {isSv ? "Har du konto? " : "Have an account? "}
              <button type="button" className={styles.footerLinkUnderline} onClick={() => switchMode("login")}>
                {isSv ? "Logga in" : "Sign in"}
              </button>
            </p>
          )}
          {mode === "forgot" && (
            <p className={styles.footerText}>
              <button type="button" className={styles.footerLinkUnderline} onClick={() => switchMode("login")}>
                {isSv ? "← Tillbaka" : "← Back to sign in"}
              </button>
            </p>
          )}
        </div>
      </div>
    </main>
    </>
  );
}

/** Google's four-colour "G", inlined so the button needs no network request. */
function GoogleMark() {
  return (
    <svg className={styles.googleMark} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.34A9 9 0 0 0 9 18Z"
      />
      <path fill="#FBBC05" d="M3.97 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.33Z" />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
