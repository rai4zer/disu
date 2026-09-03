"use client";

/**
 * The Quant tab: run a projection for this instrument and read it condensed.
 *
 * The full `/quant` module asked you to type a ticker before it could do
 * anything. On an instrument page the ticker is already settled, so this is the
 * whole interaction: press run, wait, read.
 *
 * Two views of one result, which is the point of the layout. The **projection
 * strip** is the shape — where each horizon lands relative to today's close —
 * and the **table** behind "Show detail" is the numbers, for someone who wants
 * the probability and the implied price rather than the picture.
 *
 * What this panel refuses to do is soften the output. `p_up` is a model
 * probability, not a recommendation, and §7.2 of the roadmap is a real
 * regulatory line: a projection is an illustration. So the disclaimer is not
 * dismissible and the wording never turns a number into advice.
 */

import { useCallback, useState } from "react";
import { pollJobResultWithProgress } from "@/app/lib/jobs/client";
import styles from "./page.module.css";

type QuantRow = {
  date: string;
  ticker: string;
  horizon: number;
  adj_close: number;
  pred_return: number;
  p_up: number;
  implied_price: number;
};

type QuantResult = { ok?: boolean; rows?: QuantRow[]; error?: string };

type Stage = "idle" | "queued" | "running" | "done" | "failed";

export default function QuantPanel({ symbol, sv }: { symbol: string; sv: boolean }) {
  const [stage, setStage] = useState<Stage>("idle");
  const [rows, setRows] = useState<QuantRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);

  const run = useCallback(async () => {
    setStage("queued");
    setError(null);
    setRows([]);
    try {
      const response = await fetch("/api/quant/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: symbol, retrain: false })
      });
      const queued = (await response.json()) as { ok?: boolean; jobId?: string; error?: string };
      if (!response.ok || !queued.jobId) {
        throw new Error(queued.error ?? `Quant enqueue failed (${response.status}).`);
      }

      const result = await pollJobResultWithProgress<QuantResult>(queued.jobId, {
        onProgress: (job) => setStage(job.status === "running" ? "running" : "queued")
      });

      const received = Array.isArray(result?.rows) ? result.rows : [];
      if (received.length === 0) {
        // A run that produced no rows is not a run that produced zeros. Saying
        // "no projection" is the honest outcome.
        throw new Error(result?.error ?? (sv ? "Ingen projektion kunde beräknas." : "No projection could be computed."));
      }
      setRows([...received].sort((a, b) => a.horizon - b.horizon));
      setStage("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStage("failed");
    }
  }, [symbol, sv]);

  const busy = stage === "queued" || stage === "running";

  // Every horizon shares one scale so the strip is comparable across rows —
  // a bar twice as long means twice the projected move, not a longer horizon.
  const maxAbs = rows.reduce((m, r) => Math.max(m, Math.abs(r.pred_return)), 0);

  return (
    <div className={styles.panel}>
      <div className={styles.toolHead}>
        <div>
          <h2>{sv ? "Kvantitativ projektion" : "Quantitative projection"}</h2>
          <p className={styles.note}>
            {sv
              ? "Modellerad utveckling per tidshorisont, beräknad på historiska priser."
              : "Modelled outcome per horizon, computed from historical prices."}
          </p>
        </div>
        <button type="button" className={styles.runButton} onClick={() => void run()} disabled={busy}>
          {busy
            ? sv
              ? "Kör…"
              : "Running…"
            : rows.length > 0
              ? sv
                ? "Kör igen"
                : "Run again"
              : sv
                ? "Kör Quant"
                : "Run Quant"}
        </button>
      </div>

      {busy ? (
        <p className={styles.note}>
          {stage === "queued"
            ? sv
              ? "I kö…"
              : "Queued…"
            : sv
              ? "Beräknar. Det tar vanligtvis under en minut."
              : "Computing. This usually takes under a minute."}
        </p>
      ) : null}

      {stage === "failed" && error ? <p className={styles.toolError}>{error}</p> : null}

      {rows.length > 0 ? (
        <>
          <ul className={styles.horizons}>
            {rows.map((row) => {
              const pct = row.pred_return * 100;
              const width = maxAbs > 0 ? (Math.abs(row.pred_return) / maxAbs) * 50 : 0;
              return (
                <li key={row.horizon} className={styles.horizon}>
                  <span className={styles.horizonLabel}>
                    {row.horizon} {sv ? "d" : "d"}
                  </span>
                  {/* Centre line is today. A bar grows left for a projected
                      fall and right for a projected rise, so direction reads
                      before any number does. */}
                  <span className={styles.horizonTrack}>
                    <span className={styles.horizonZero} aria-hidden="true" />
                    <span
                      className={pct >= 0 ? `${styles.horizonBar} ${styles.horizonUp}` : `${styles.horizonBar} ${styles.horizonDown}`}
                      style={pct >= 0 ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }}
                    />
                  </span>
                  <span className={pct >= 0 ? styles.horizonUpText : styles.horizonDownText}>
                    {pct >= 0 ? "+" : "−"}
                    {Math.abs(pct).toFixed(2)}%
                  </span>
                </li>
              );
            })}
          </ul>

          <button type="button" className={styles.expand} onClick={() => setDetail((v) => !v)} aria-expanded={detail}>
            {detail ? (sv ? "Dölj detaljer" : "Hide detail") : sv ? "Visa detaljer" : "Show detail"}
          </button>

          {detail ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{sv ? "Horisont" : "Horizon"}</th>
                    <th scope="col">{sv ? "Förv. avkastning" : "Expected return"}</th>
                    <th scope="col">{sv ? "Sannolikhet upp" : "Probability up"}</th>
                    <th scope="col">{sv ? "Implicit kurs" : "Implied price"}</th>
                    <th scope="col">{sv ? "Från kurs" : "From close"}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.horizon}>
                      <td>
                        {row.horizon} {sv ? "dagar" : "days"}
                      </td>
                      <td className={row.pred_return >= 0 ? styles.horizonUpText : styles.horizonDownText}>
                        {row.pred_return >= 0 ? "+" : "−"}
                        {Math.abs(row.pred_return * 100).toFixed(2)}%
                      </td>
                      <td>{(row.p_up * 100).toFixed(1)}%</td>
                      <td>{row.implied_price.toLocaleString("en-GB", { maximumFractionDigits: 2 })}</td>
                      <td>{row.adj_close.toLocaleString("en-GB", { maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* Not dismissible, and deliberately worded as an illustration rather
              than an outlook. ROADMAP §7.2 treats this as a regulatory line, not
              a stylistic one. */}
          <p className={styles.disclaimer}>
            {sv
              ? "Detta är en modellberäknad illustration av möjliga utfall, inte en prognos och inte investeringsrådgivning. Historiska priser förutsäger inte framtida avkastning."
              : "This is a model-computed illustration of possible outcomes — not a forecast, and not investment advice. Past prices do not predict future returns."}
          </p>
        </>
      ) : null}

      {stage === "idle" ? (
        <p className={styles.note}>
          {sv
            ? "Ingen körning ännu. Resultatet beräknas när du klickar."
            : "No run yet. The projection is computed when you ask for it."}
        </p>
      ) : null}
    </div>
  );
}
