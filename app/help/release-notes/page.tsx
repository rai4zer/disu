"use client";

import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import styles from "../page.module.css";

export default function HelpReleaseNotesPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Versionsnyheter" : "Release notes"}
        subtitle={isSv ? "Senaste ändringar i funktioner, stabilitet och UX." : "Latest changes in features, stability, and UX."}
      >
        <section className={`${styles.card} appSection`}>
          <h2>{isSv ? "Kommer härnäst" : "Coming next"}</h2>
          <p>
            {isSv
              ? "Här lägger vi versionslogg med datum, förbättringar och eventuella brytande ändringar."
              : "We will add a release log with dates, improvements, and any breaking changes here."}
          </p>
        </section>

        <section className={styles.feedbackMinimal} aria-label={isSv ? "Skicka förslag" : "Send feedback"}>
          <label className={styles.feedbackMinimalLabel} htmlFor="release-notes-feedback">
            {isSv ? "Vad ska vi bygga härnäst?" : "What should we build next?"}
          </label>
          <div className={styles.feedbackMinimalRow}>
            <input
              id="release-notes-feedback"
              className={styles.feedbackMinimalInput}
              placeholder={
                isSv
                  ? "T.ex. jämför flera tickers i Quant"
                  : "e.g. compare multiple tickers in Quant"
              }
            />
            <button type="button" className={styles.feedbackMinimalButton}>
              {isSv ? "Skicka" : "Send"}
            </button>
          </div>
        </section>
      </Workspace>
    </main>
  );
}
