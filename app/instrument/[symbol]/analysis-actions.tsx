"use client";

/**
 * The two analysis tools, offered where the eye already is.
 *
 * This is the foot of the trade ticket rather than a card of its own: a second
 * card in the rail put a border between the ticket and the two buttons and left
 * the ticket's own bottom edge ragged against the chart. Each tool is a mark
 * and its name, side by side — the two are peers and read as a pair rather than
 * as a list of two explained features. Quant no longer has a tab at all: its
 * output is the projection on the chart, so the button is the whole surface.
 * Primer keeps its tab, which is where its text is read.
 *
 * Neither button owns its run. Both call into the hooks the page holds
 * (`use-tool-runs.ts`), so the projection lands on the chart, the tab shows the
 * same numbers, and pressing the button twice does not queue two jobs.
 */

import type { PrimerRun, QuantRun } from "./use-tool-runs";
import styles from "./analysis-actions.module.css";

/** A ten-day projection: history solid, the horizon dashed off the last point. */
function QuantMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2.5 15.5 L6.5 11 L10 13.5 L13.5 7.5" className={styles.markStroke} />
      <path d="M13.5 7.5 L17 10 L21.5 4.5" className={styles.markDashed} />
      <circle cx="13.5" cy="7.5" r="2" className={styles.markDot} />
      <path d="M2.5 19.5 H21.5" className={styles.markAxis} />
    </svg>
  );
}

/** A filing, folded corner and all, with its text read down to a summary. */
function PrimerMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 2.75 H14 L18.5 7.25 V21.25 H6 Z" className={styles.markStroke} />
      <path d="M14 2.75 V7.25 H18.5" className={styles.markStroke} />
      <path d="M9 11.5 H15.5 M9 14.5 H15.5 M9 17.5 H12.5" className={styles.markAxis} />
    </svg>
  );
}

export default function AnalysisActions({
  quant,
  primer,
  showPrimer,
  onQuant,
  onPrimer,
  sv
}: {
  quant: QuantRun;
  primer: PrimerRun;
  /** Primers read SEC EDGAR, so the button only exists for US filers. */
  showPrimer: boolean;
  onQuant: () => void;
  onPrimer: () => void;
  sv: boolean;
}) {
  return (
    <section className={styles.block} aria-label={sv ? "Analys" : "Analysis"}>
      {/* Sits at the ticket's own type scale for a label rather than the 14px a
          card heading gets: inside the ticket it names a group, it does not open
          a new card, and two bold headings in one box read as two boxes. */}
      <h2 className={styles.heading}>{sv ? "Analys" : "Analysis"}</h2>

      {/* Name and mark only. A running job still says so — the spinner is state,
          not description, and dropping it would leave a dead-looking button for
          the tens of seconds the job takes. */}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          onClick={onQuant}
          disabled={quant.busy}
          aria-busy={quant.busy}
        >
          <span className={`${styles.logo} ${styles.logoQuant}`}>
            <QuantMark />
          </span>
          <span className={styles.label}>Quant</span>
          {quant.busy ? <span className={styles.spinner} aria-hidden="true" /> : null}
        </button>

        {showPrimer ? (
          <button
            type="button"
            className={styles.action}
            onClick={onPrimer}
            disabled={primer.busy}
            aria-busy={primer.busy}
          >
            <span className={`${styles.logo} ${styles.logoPrimer}`}>
              <PrimerMark />
            </span>
            <span className={styles.label}>Primer</span>
            {primer.busy ? <span className={styles.spinner} aria-hidden="true" /> : null}
          </button>
        ) : null}
      </div>

      {quant.stage === "failed" && quant.error ? <p className={styles.error}>{quant.error}</p> : null}
      {showPrimer && primer.stage === "failed" && primer.error ? (
        <p className={styles.error}>{primer.error}</p>
      ) : null}
    </section>
  );
}
