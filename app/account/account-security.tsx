"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import {
  PASSWORD_MESSAGES,
  PASSWORD_MIN_LENGTH,
  checkPasswordShape,
  passwordPolicyMessage,
  type PasswordRejectionCode
} from "@/app/lib/auth/password-policy";
import styles from "./page.module.css";

type Props = {
  googleEnabled: boolean;
};

type SecurityState = {
  email: string;
  hasPassword: boolean;
  googleLinked: boolean;
  googleSignInConfigured: boolean;
  canUnlinkGoogle: boolean;
};

/**
 * Copy for the slugs the OAuth callback can send back to this page on
 * `?googleError=`. The link-specific ones are the two shapes `linkGoogleToUser`
 * refuses, plus the account-changed-mid-flow case; the rest are the same
 * transport failures the login form handles.
 */
function googleErrorMessage(code: string, isSv: boolean): string {
  switch (code) {
    case "access_denied":
      return isSv ? "Google-kopplingen avbröts." : "Connecting Google was cancelled.";
    case "google_already_linked":
      return isSv
        ? "Det Google-kontot är redan kopplat till ett annat DISU-konto."
        : "That Google account is already connected to another DISU account.";
    case "email_in_use":
      return isSv
        ? "Ett annat DISU-konto använder redan den e-postadressen."
        : "Another DISU account already uses that email address.";
    case "link_session_mismatch":
      return isSv
        ? "Inloggningen ändrades under kopplingen. Försök igen."
        : "The signed-in account changed during the link. Try again.";
    case "email_not_verified":
      return isSv
        ? "Din Google-adress är inte verifierad. Verifiera den hos Google och försök igen."
        : "Your Google email address is not verified. Verify it with Google and try again.";
    case "google_not_configured":
      return isSv ? "Google är inte tillgängligt just nu." : "Google is not available right now.";
    case "expired_state":
    case "invalid_state":
    case "missing_nonce":
    case "missing_verifier":
    case "missing_oauth_params":
      return isSv
        ? "Kopplingen tog för lång tid eller avbröts. Försök igen."
        : "The link expired or was interrupted. Try again.";
    default:
      return isSv ? "Kunde inte koppla Google. Försök igen." : "Could not connect Google. Try again.";
  }
}

export default function AccountSecurity({ googleEnabled }: Props) {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const searchParams = useSearchParams();

  const [state, setState] = useState<SecurityState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);

  const [unlinkArmed, setUnlinkArmed] = useState(false);
  const [unlinkBusy, setUnlinkBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googleNotice, setGoogleNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/account/security", { cache: "no-store" });
      const payload = (await response.json()) as SecurityState & { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setLoadError(payload.error ?? (isSv ? "Kunde inte läsa kontot." : "Could not load the account."));
        return;
      }
      setLoadError(null);
      setState({
        email: payload.email,
        hasPassword: payload.hasPassword,
        googleLinked: payload.googleLinked,
        googleSignInConfigured: payload.googleSignInConfigured,
        canUnlinkGoogle: payload.canUnlinkGoogle
      });
    } catch {
      setLoadError(isSv ? "Kunde inte läsa kontot." : "Could not load the account.");
    }
  }, [isSv]);

  useEffect(() => {
    void load();
  }, [load]);

  // The OAuth link is a full-page redirect, so its result arrives as a query
  // parameter rather than a fetch response.
  useEffect(() => {
    const error = searchParams.get("googleError");
    if (error) {
      setGoogleError(googleErrorMessage(error, isSv));
      return;
    }
    if (searchParams.get("googleLinked") === "1") {
      setGoogleNotice(isSv ? "Google är nu kopplat till kontot." : "Google is now connected to this account.");
    }
  }, [searchParams, isSv]);

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state) {
      return;
    }
    setPasswordError(null);
    setPasswordNotice(null);

    if (newPassword !== confirmPassword) {
      setPasswordError(isSv ? "Lösenorden matchar inte." : "The passwords do not match.");
      return;
    }

    // Screened locally first so the predictable rejections are instant; the
    // server runs the same check plus the breach lookup.
    const verdict = checkPasswordShape(newPassword, { email: state.email });
    if (!verdict.ok) {
      setPasswordError(passwordPolicyMessage(verdict.code, isSv ? "sv" : "en"));
      return;
    }

    setPasswordBusy(true);
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: state.hasPassword ? currentPassword : undefined,
          newPassword
        })
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
        otherSessionsEnded?: number;
      };

      if (!response.ok || !payload.ok) {
        const fallback = payload.error ?? (isSv ? "Kunde inte uppdatera lösenordet." : "Could not update the password.");
        setPasswordError(
          payload.code && payload.code in PASSWORD_MESSAGES
            ? passwordPolicyMessage(payload.code as PasswordRejectionCode, isSv ? "sv" : "en")
            : fallback
        );
        return;
      }

      const ended = payload.otherSessionsEnded ?? 0;
      setPasswordNotice(
        [
          state.hasPassword
            ? isSv
              ? "Lösenordet är uppdaterat."
              : "Password updated."
            : isSv
              ? "Lösenordet är satt. Du kan nu logga in med e-post och lösenord."
              : "Password set. You can now sign in with email and password.",
          ended > 0
            ? isSv
              ? `${ended} annan inloggning avslutades.`
              : `${ended} other signed-in device was signed out.`
            : null
        ]
          .filter(Boolean)
          .join(" ")
      );
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await load();
    } catch {
      setPasswordError(isSv ? "Kunde inte uppdatera lösenordet." : "Could not update the password.");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function handleUnlink() {
    setGoogleError(null);
    setGoogleNotice(null);
    setUnlinkBusy(true);
    try {
      const response = await fetch("/api/account/google", { method: "DELETE" });
      const payload = (await response.json()) as { ok?: boolean; error?: string; code?: string };
      if (!response.ok || !payload.ok) {
        setGoogleError(
          payload.code === "password_required"
            ? isSv
              ? "Sätt ett lösenord först, annars kan du inte logga in."
              : "Set a password first, or you will not be able to sign in."
            : payload.error ?? (isSv ? "Kunde inte koppla bort Google." : "Could not disconnect Google.")
        );
        return;
      }
      setGoogleNotice(isSv ? "Google är bortkopplat." : "Google is disconnected.");
      setUnlinkArmed(false);
      await load();
    } catch {
      setGoogleError(isSv ? "Kunde inte koppla bort Google." : "Could not disconnect Google.");
    } finally {
      setUnlinkBusy(false);
    }
  }

  // The server-rendered prop is what shows before the fetch lands; the API value
  // is authoritative once it does. The section stays visible for an account that
  // is *already* linked even when the OAuth client is gone, or removing the env
  // vars would strand a link nobody can detach.
  const googleAvailable = state ? state.googleSignInConfigured : googleEnabled;
  const googleVisible = googleAvailable || Boolean(state?.googleLinked);

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Konto" : "Account"}
        subtitle={isSv ? "Inloggningsmetoder för det här kontot." : "How you sign in to this account."}
        size="narrow"
      >
        {loadError && <p className={styles.error}>{loadError}</p>}

        <section className={`${styles.card} appSection`}>
          <h2>{isSv ? "Inloggningsmetoder" : "Sign-in methods"}</h2>
          <dl className={styles.summary}>
            <div>
              <dt>{isSv ? "E-post" : "Email"}</dt>
              <dd>{state?.email ?? "—"}</dd>
            </div>
            <div>
              <dt>{isSv ? "Lösenord" : "Password"}</dt>
              <dd>
                {state ? (
                  state.hasPassword ? (
                    isSv ? "Satt" : "Set"
                  ) : (
                    <span className={styles.warn}>{isSv ? "Inget lösenord" : "No password"}</span>
                  )
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>Google</dt>
              <dd>
                {state
                  ? state.googleLinked
                    ? isSv
                      ? "Kopplat"
                      : "Connected"
                    : isSv
                      ? "Inte kopplat"
                      : "Not connected"
                  : "—"}
              </dd>
            </div>
          </dl>
        </section>

        <section className={`${styles.card} appSection`}>
          <h2>
            {state?.hasPassword
              ? isSv
                ? "Byt lösenord"
                : "Change password"
              : isSv
                ? "Sätt ett lösenord"
                : "Set a password"}
          </h2>
          <p className={styles.hint}>
            {state?.hasPassword
              ? isSv
                ? "Alla andra inloggade enheter loggas ut. Den här förblir inloggad."
                : "Every other signed-in device is signed out. This one stays signed in."
              : isSv
                ? "Du loggade in med Google, så kontot har inget lösenord. Ett lösenord låter dig logga in med e-post också — och krävs innan du kan koppla bort Google eller radera kontot."
                : "You signed in with Google, so this account has no password. Adding one lets you sign in with email too — and is required before you can disconnect Google or erase the account."}
          </p>

          <form className={styles.form} onSubmit={(event) => void handlePasswordSubmit(event)}>
            {state?.hasPassword && (
              <label className={styles.field}>
                <span>{isSv ? "Nuvarande lösenord" : "Current password"}</span>
                <input
                  className={styles.input}
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                />
              </label>
            )}

            <label className={styles.field}>
              <span>{isSv ? "Nytt lösenord" : "New password"}</span>
              <input
                className={styles.input}
                type="password"
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </label>

            <label className={styles.field}>
              <span>{isSv ? "Upprepa nytt lösenord" : "Repeat new password"}</span>
              <input
                className={styles.input}
                type="password"
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </label>

            {passwordError && <p className={styles.error}>{passwordError}</p>}
            {passwordNotice && <p className={styles.notice}>{passwordNotice}</p>}

            <div className={styles.actions}>
              <button className={styles.button} type="submit" disabled={passwordBusy || !state}>
                {passwordBusy
                  ? isSv
                    ? "Sparar..."
                    : "Saving..."
                  : state?.hasPassword
                    ? isSv
                      ? "Byt lösenord"
                      : "Change password"
                    : isSv
                      ? "Sätt lösenord"
                      : "Set password"}
              </button>
            </div>
          </form>
        </section>

        {googleVisible && (
          <section className={`${styles.card} appSection`}>
            <h2>Google</h2>
            <p className={styles.hint}>
              {state?.googleLinked
                ? isSv
                  ? "Du kan logga in med Google på det här kontot."
                  : "You can sign in to this account with Google."
                : isSv
                  ? "Koppla Google för att logga in med ett klick."
                  : "Connect Google to sign in with one click."}
            </p>

            {googleError && <p className={styles.error}>{googleError}</p>}
            {googleNotice && <p className={styles.notice}>{googleNotice}</p>}

            {state?.googleLinked ? (
              <div className={styles.actions}>
                {state.canUnlinkGoogle ? (
                  unlinkArmed ? (
                    <>
                      <button
                        className={styles.dangerButton}
                        type="button"
                        onClick={() => void handleUnlink()}
                        disabled={unlinkBusy}
                      >
                        {unlinkBusy
                          ? isSv
                            ? "Kopplar bort..."
                            : "Disconnecting..."
                          : isSv
                            ? "Bekräfta bortkoppling"
                            : "Confirm disconnect"}
                      </button>
                      <button
                        className={styles.ghostButton}
                        type="button"
                        onClick={() => setUnlinkArmed(false)}
                        disabled={unlinkBusy}
                      >
                        {isSv ? "Avbryt" : "Cancel"}
                      </button>
                    </>
                  ) : (
                    <button className={styles.button} type="button" onClick={() => setUnlinkArmed(true)}>
                      {isSv ? "Koppla bort Google" : "Disconnect Google"}
                    </button>
                  )
                ) : (
                  <p className={styles.hint}>
                    {isSv
                      ? "Sätt ett lösenord innan du kopplar bort Google — annars finns ingen väg in i kontot."
                      : "Set a password before disconnecting Google — otherwise there would be no way into the account."}
                  </p>
                )}
              </div>
            ) : googleAvailable ? (
              <div className={styles.actions}>
                {/* A plain link, not fetch(): connecting is a full-page redirect
                    to accounts.google.com and back. */}
                <a className={styles.button} href="/api/auth/google/start?mode=link&next=/account">
                  {isSv ? "Koppla Google" : "Connect Google"}
                </a>
              </div>
            ) : (
              <p className={styles.hint}>
                {isSv ? "Google är inte tillgängligt just nu." : "Google is not available right now."}
              </p>
            )}
          </section>
        )}
      </Workspace>
    </main>
  );
}
