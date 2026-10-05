"use client";

/**
 * The Primers tab: a plain-language read of this company's latest SEC filing.
 *
 * US filers only — the pipeline reads EDGAR (`python/src/filings/edgar.py`), so
 * the tab does not exist for a Stockholm listing (`instrument-tools.ts`).
 *
 * Condensed here means *the first screen is the primer*, not a form. The `/primers`
 * module asked for a ticker and a provider before it would do anything; on an
 * instrument page both are settled, so the panel is a run button and then prose.
 *
 * Two things travel with the text and must not be dropped. Which filing it came
 * from — form and date — because a primer written from a 10-K two quarters old
 * is a different claim from one written this week. And that the prose is
 * model-written from that filing: it is a summary of a real document, which is
 * why it is allowed on the page at all, and the reader is told so rather than
 * left to assume a human wrote it.
 */

import type { PrimerRun } from "./use-tool-runs";
import styles from "./page.module.css";

/**
 * The run lives in the page (`use-tool-runs.ts`), so the rail's Primer button
 * and this panel are the same job: pressing the button in the rail opens this
 * tab with the run already under way.
 */
export default function PrimerPanel({ run: primer, sv }: { run: PrimerRun; sv: boolean }) {
  const { stage, result, error, busy, run } = primer;

  return (
    <div className={styles.panel}>
      <div className={styles.toolHead}>
        <div>
          <h2>{sv ? "Bolagsprimer" : "Company primer"}</h2>
          <p className={styles.note}>
            {sv
              ? "Senaste SEC-rapporten i klarspråk."
              : "The latest SEC filing, in plain language."}
          </p>
        </div>
        <button type="button" className={styles.runButton} onClick={run} disabled={busy}>
          {busy
            ? sv
              ? "Kör…"
              : "Running…"
            : result
              ? sv
                ? "Kör igen"
                : "Run again"
              : sv
                ? "Skapa primer"
                : "Generate primer"}
        </button>
      </div>

      {busy ? (
        <p className={styles.note}>
          {stage === "queued"
            ? sv
              ? "I kö…"
              : "Queued…"
            : sv
              ? "Läser rapporten. Det kan ta ett par minuter första gången."
              : "Reading the filing. This can take a couple of minutes the first time."}
        </p>
      ) : null}

      {stage === "failed" && error ? <p className={styles.toolError}>{error}</p> : null}

      {result?.primer_text ? (
        <>
          {/* Provenance first. Which filing, and when it was filed — a primer
              from a two-quarter-old 10-K is a different claim from a fresh one,
              and the text itself does not say. */}
          <p className={styles.note}>
            {result.form ? <strong>{result.form}</strong> : null}
            {result.filing_date
              ? `${result.form ? " · " : ""}${sv ? "inlämnad" : "filed"} ${new Date(result.filing_date).toLocaleDateString(
                  sv ? "sv-SE" : "en-GB",
                  { dateStyle: "medium" }
                )}`
              : null}
            {result.cached ? (sv ? " · från cache" : " · from cache") : null}
          </p>

          <div className={styles.primerText}>
            {result.primer_text
              .split(/\n{2,}/)
              .filter((para) => para.trim())
              .map((para, idx) => (
                <p key={idx}>{para.trim()}</p>
              ))}
          </div>

          <p className={styles.disclaimer}>
            {sv
              ? "Denna text är automatiskt sammanfattad från bolagets egen SEC-rapport av en språkmodell. Den kan innehålla fel eller utelämna väsentligheter — läs originalrapporten innan du fattar ett beslut. Det är inte investeringsrådgivning."
              : "This text is automatically summarised from the company's own SEC filing by a language model. It may contain errors or omit something material — read the original filing before acting on it. It is not investment advice."}
          </p>
        </>
      ) : null}

      {stage === "idle" ? (
        <p className={styles.note}>
          {sv
            ? "Ingen primer ännu. Den skrivs när du klickar."
            : "No primer yet. It is written when you ask for it."}
        </p>
      ) : null}
    </div>
  );
}
