"use client";

/**
 * What the user sees when a render throws, and the thing that reports it.
 *
 * Shared by `app/error.tsx` and `app/global-error.tsx`. The global boundary
 * replaces the root layout — providers included — so this component cannot
 * read the language from context. It reads `documentElement.lang`, which the
 * inline script in the layout sets before first paint and `LanguageProvider`
 * keeps current, and falls back to English.
 */

import { useEffect, useState } from "react";
import { getUiCopy } from "@/app/i18n/ui-copy";
import type { AppLanguage } from "@/app/i18n/language";
import { reportClientError } from "@/app/lib/observability/report-client-error";
import styles from "./error-fallback.module.css";

type Props = {
  error: Error & { digest?: string };
  /** React's boundary reset. Absent when the caller has nothing to re-render. */
  reset?: () => void;
  /** Distinguishes a route-level crash from one that took the whole layout. */
  scope: "route" | "root";
};

function currentLanguage(): AppLanguage {
  if (typeof document === "undefined") {
    return "en";
  }
  return document.documentElement.lang === "sv" ? "sv" : "en";
}

export default function ErrorFallback({ error, reset, scope }: Props) {
  const [language, setLanguage] = useState<AppLanguage>("en");

  // Read after mount: the server renders `en` and correcting it here avoids a
  // hydration mismatch on a page that is already in a bad state.
  useEffect(() => {
    setLanguage(currentLanguage());
  }, []);

  useEffect(() => {
    reportClientError(error, { kind: "react", digest: error.digest });
  }, [error]);

  const copy = getUiCopy(language).errorBoundary;

  return (
    <div className={styles.wrap}>
      <div className={styles.card} role="alert">
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.body}>{scope === "root" ? copy.bodyRoot : copy.body}</p>
        <div className={styles.actions}>
          {reset ? (
            <button type="button" className={styles.primary} onClick={reset}>
              {copy.retry}
            </button>
          ) : null}
          <a className={styles.secondary} href="/">
            {copy.home}
          </a>
        </div>
        {error.digest ? (
          <p className={styles.reference}>
            {copy.reference} <code>{error.digest}</code>
          </p>
        ) : null}
      </div>
    </div>
  );
}
