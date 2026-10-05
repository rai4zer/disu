"use client";

/**
 * The two long-running instrument tools, lifted out of their panels.
 *
 * Quant and the primer used to own their own state inside the tab that drew
 * them, which was fine while the tab was the only way to start one. It is not
 * any more: the rail beside the chart has a button for each, the chart itself
 * draws the quant projection, and the tab shows the same run in detail. Three
 * views of one run means one owner, and the page is the only component that
 * sees all three.
 *
 * So these hooks hold the run and every surface reads it. Pressing Quant in the
 * rail and then opening the Quant tab shows the result that is already there —
 * it does not start a second job against the same ticker.
 */

import { useCallback, useState } from "react";
import { pollJobResultWithProgress } from "@/app/lib/jobs/client";

export type QuantRow = {
  date: string;
  ticker: string;
  horizon: number;
  adj_close: number;
  pred_return: number;
  p_up: number;
  implied_price: number;
};

export type Stage = "idle" | "queued" | "running" | "done" | "failed";

export type QuantRun = {
  stage: Stage;
  busy: boolean;
  rows: QuantRow[];
  error: string | null;
  run: () => void;
};

export type PrimerResult = {
  ok?: boolean;
  ticker?: string;
  form?: string | null;
  filing_date?: string | null;
  primer_text?: string;
  pdf_path?: string;
  cached?: boolean;
  error?: string;
};

export type PrimerRun = {
  stage: Stage;
  busy: boolean;
  result: PrimerResult | null;
  error: string | null;
  run: () => void;
};

export function useQuantRun(symbol: string, sv: boolean): QuantRun {
  const [stage, setStage] = useState<Stage>("idle");
  const [rows, setRows] = useState<QuantRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(() => {
    void (async () => {
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

        const result = await pollJobResultWithProgress<{ ok?: boolean; rows?: QuantRow[]; error?: string }>(
          queued.jobId,
          { onProgress: (job) => setStage(job.status === "running" ? "running" : "queued") }
        );

        const received = Array.isArray(result?.rows) ? result.rows : [];
        if (received.length === 0) {
          // A run that produced no rows is not a run that produced zeros.
          throw new Error(result?.error ?? (sv ? "Ingen projektion kunde beräknas." : "No projection could be computed."));
        }
        setRows([...received].sort((a, b) => a.horizon - b.horizon));
        setStage("done");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setStage("failed");
      }
    })();
  }, [symbol, sv]);

  return { stage, busy: stage === "queued" || stage === "running", rows, error, run };
}

export function usePrimerRun(symbol: string, sv: boolean): PrimerRun {
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<PrimerResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(() => {
    void (async () => {
      setStage("queued");
      setError(null);
      setResult(null);
      try {
        const response = await fetch("/api/filings-primers/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: symbol })
        });
        const queued = (await response.json()) as { ok?: boolean; jobId?: string; error?: string };
        if (!response.ok || !queued.jobId) {
          throw new Error(queued.error ?? `Primer enqueue failed (${response.status}).`);
        }

        const payload = await pollJobResultWithProgress<PrimerResult>(queued.jobId, {
          onProgress: (job) => setStage(job.status === "running" ? "running" : "queued")
        });

        if (!payload?.primer_text) {
          throw new Error(payload?.error ?? (sv ? "Ingen primer kunde genereras." : "No primer could be generated."));
        }
        setResult(payload);
        setStage("done");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setStage("failed");
      }
    })();
  }, [symbol, sv]);

  return { stage, busy: stage === "queued" || stage === "running", result, error, run };
}
