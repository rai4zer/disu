"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import Workspace from "@/app/components/workspace";
import { useSignedIn } from "@/app/components/session-context";
import { resolveTickerSymbol } from "@/app/lib/ticker-suggestions";
import TickerAutocomplete from "@/app/components/ticker-autocomplete";
import {
  cancelJob,
  dismissJob,
  getRecentJobs,
  pollJobResultWithProgress,
  retryJob
} from "@/app/lib/jobs/client";
import { useLanguage } from "@/app/i18n/language";
import UiState from "@/app/components/ui-state";

type PrimerSuccess = {
  ok: true;
  ticker: string;
  pdf_path: string;
  pdf_abspath: string;
  form: string | null;
  filing_date: string | null;
  cache_dir: string;
  primer_text: string;
  meta?: {
    pipelineVersion: string;
    llmProvider: "openai_compatible" | "none";
    llmModel: string;
    fallbackMode: "none" | "offline";
  };
};

type PrimerFailure = {
  ok: false;
  error: string;
  traceback?: string;
};

type PrimerResponse = PrimerSuccess | PrimerFailure;

type EnqueueResponse =
  | {
      ok: true;
      jobId: string;
      status: "queued" | "running";
      reused?: boolean;
    }
  | {
      ok: false;
      error: string;
    };

type ResumablePrimerJob = {
  id: string;
  ticker: string;
  status: "queued" | "running" | "failed";
};

const ACTIVE_PRIMER_JOB_KEY = "disu.jobs.primer.active";
const PRIMERS_TICKER_PREF_KEY = "pref.primers.ticker";

function createIdempotencyKey(kind: "primer", ticker: string): string {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${kind}:${ticker}:${randomPart}`.slice(0, 128);
}

export default function PrimersPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";
  // The page is public (ROADMAP §9.1) so a visitor can see what a primer is
  // before signing up. Running one still costs a filing fetch and an LLM call
  // per request, so the run itself needs an account — say so up front rather
  // than letting the button fail with a 401.
  const signedIn = useSignedIn();
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PrimerSuccess | null>(null);
  const [typedPrimer, setTypedPrimer] = useState("");
  const [resumableJob, setResumableJob] = useState<ResumablePrimerJob | null>(null);
  const [jobStage, setJobStage] = useState<"queued" | "fetching" | "running" | "done" | "failed">("queued");
  const [signInPrompted, setSignInPrompted] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const savedTicker = window.localStorage.getItem(PRIMERS_TICKER_PREF_KEY);
    if (savedTicker) {
      setTicker(savedTicker);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (ticker.trim()) {
      window.localStorage.setItem(PRIMERS_TICKER_PREF_KEY, ticker.trim().toUpperCase());
    }
  }, [ticker]);

  function readActiveJobId(): string {
    if (typeof window === "undefined") {
      return "";
    }
    return window.localStorage.getItem(ACTIVE_PRIMER_JOB_KEY) ?? "";
  }

  function setActiveJobId(jobId: string): void {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ACTIVE_PRIMER_JOB_KEY, jobId);
  }

  function clearActiveJobId(jobId?: string): void {
    if (typeof window === "undefined") {
      return;
    }
    const active = readActiveJobId();
    if (!jobId || active === jobId) {
      window.localStorage.removeItem(ACTIVE_PRIMER_JOB_KEY);
    }
  }

  async function resumeJob(jobId: string): Promise<void> {
    setLoading(true);
    setError(null);
    setJobStage("queued");
    setActiveJobId(jobId);
    try {
      const payload = await pollJobResultWithProgress<PrimerResponse>(jobId, {
        attempts: 120,
        intervalMs: 2000,
        onProgress: (job) => {
          if (job.stage) {
            setJobStage(job.stage);
          }
        }
      });
      if (!payload.ok) {
        setError(payload.error);
        return;
      }
      setTicker(payload.ticker);
      setResult(payload);
      clearActiveJobId(jobId);
      setResumableJob(null);
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : isSv ? "Begäran misslyckades" : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  const cleanedPrimer = useMemo(() => {
    const raw = result?.primer_text ?? "";
    if (!raw) {
      return "";
    }

    return raw
      .replace(/\r\n/g, "\n")
      .replace(
        /(^|\n)(Company Snapshot|Economic Engine|Business Model|Operating Segments|Period over Period|Watchlist|Latest News|Financial Picture|Income Statement \(condensed\)|Balance Sheet \(condensed\)|Cash Flow \(condensed\))/g,
        "\n\n$2\n"
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }, [result]);

  const pdfUrl = useMemo(() => {
    if (!result?.pdf_path) {
      return null;
    }
    const file = result.pdf_path.split("/").pop();
    if (!file) {
      return null;
    }
    return `/api/filings-primers/pdf?file=${encodeURIComponent(file)}`;
  }, [result]);

  const pdfDownloadUrl = useMemo(() => {
    if (!pdfUrl) {
      return null;
    }
    return `${pdfUrl}&download=1`;
  }, [pdfUrl]);

  useEffect(() => {
    const text = cleanedPrimer;
    if (!text) {
      setTypedPrimer("");
      return;
    }

    setTypedPrimer("");
    const total = text.length;
    const durationMs = Math.min(3800, Math.max(650, Math.round((total / 260) * 1000)));
    const start = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - (1 - progress) * (1 - progress);
      const chars = Math.max(1, Math.floor(total * eased));
      setTypedPrimer(text.slice(0, chars));

      if (progress < 1) {
        raf = window.requestAnimationFrame(tick);
      }
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [cleanedPrimer]);

  useEffect(() => {
    let cancelled = false;

    // /api/jobs stays gated, and a signed-out visitor has no jobs to resume.
    if (!signedIn) {
      setResumableJob(null);
      return;
    }

    async function loadResumableJob(): Promise<void> {
      try {
        const jobs = await getRecentJobs("primer", 8);
        if (cancelled) {
          return;
        }

        const activeJobId = readActiveJobId();
        const activeMatch = jobs.find((job) => job.id === activeJobId && (job.status === "queued" || job.status === "running"));
        const fallbackMatch = jobs.find((job) => job.status === "queued" || job.status === "running");
        const failedMatch = jobs.find((job) => job.status === "failed");
        const match = activeMatch ?? fallbackMatch ?? failedMatch;
        if (!match) {
          setResumableJob(null);
          return;
        }

        const tickerFromPayload =
          typeof match.payload?.ticker === "string" ? match.payload.ticker.trim().toUpperCase() : "Unknown";
        setResumableJob({
          id: match.id,
          ticker: tickerFromPayload || "Unknown",
          status: match.status === "running" ? "running" : match.status === "failed" ? "failed" : "queued"
        });
      } catch {
        // Keep page functional if resumable job discovery fails.
      }
    }

    void loadResumableJob();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signedIn) {
      setSignInPrompted(true);
      return;
    }
    const typed = ticker.trim();
    let requestedTicker = (resolveTickerSymbol(typed) ?? typed.toUpperCase()).trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,12}$/.test(requestedTicker) && typed.length >= 2) {
      try {
        const response = await fetch(`/api/tickers/search?q=${encodeURIComponent(typed)}&limit=1`);
        const payload = (await response.json()) as { ok: boolean; suggestions?: Array<{ symbol?: string }> };
        if (payload.ok) {
          const firstSymbol = String(payload.suggestions?.[0]?.symbol ?? "").trim().toUpperCase();
          if (/^[A-Z0-9.\-]{1,12}$/.test(firstSymbol)) {
            requestedTicker = firstSymbol;
          }
        }
      } catch {
        // keep resolved/local ticker if suggestion endpoint fails.
      }
    }
    if (!requestedTicker) {
      return;
    }
    const currentTicker = result?.ticker ?? null;
    const isDifferentTicker = currentTicker !== null && currentTicker !== requestedTicker;

    if (isDifferentTicker) {
      setResult(null);
      setTypedPrimer("");
    }

    setLoading(true);
    setError(null);
    setJobStage("queued");

    if (!isDifferentTicker) {
      setResult(null);
    }

    try {
      const response = await fetch("/api/filings-primers/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ticker: requestedTicker,
          llmProvider: "openai_compatible",
          idempotencyKey: createIdempotencyKey("primer", requestedTicker)
        })
      });

      const queued = (await response.json()) as EnqueueResponse;
      if (!queued.ok) {
        setError(queued.error);
        return;
      }

      setActiveJobId(queued.jobId);
      const payload = await pollJobResultWithProgress<PrimerResponse>(queued.jobId, {
        attempts: 120,
        intervalMs: 2000,
        onProgress: (job) => {
          if (job.stage) {
            setJobStage(job.stage);
          }
        }
      });
      if (!payload.ok) {
        setError(payload.error);
        return;
      }

      setTicker(payload.ticker);
      setResult(payload);
      clearActiveJobId(queued.jobId);
      setResumableJob(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : isSv ? "Begäran misslyckades" : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  async function onCancelResumable(jobId: string): Promise<void> {
    try {
      await cancelJob(jobId);
      clearActiveJobId(jobId);
      setResumableJob((prev) => (prev && prev.id === jobId ? { ...prev, status: "failed" } : prev));
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : isSv ? "Kunde inte avbryta jobb" : "Could not cancel job");
    }
  }

  async function onRetryResumable(jobId: string): Promise<void> {
    try {
      const retried = await retryJob(jobId);
      setActiveJobId(retried.jobId);
      await resumeJob(retried.jobId);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : isSv ? "Kunde inte starta om jobb" : "Could not retry job");
    }
  }

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Primers" : "Primers"}
        subtitle={isSv ? "Skapa en tydlig bolagssammanfattning från rapportfiler för valfri ticker." : "Generate a clear filing-based company brief for any ticker."}
      >

        <form onSubmit={onSubmit} className={`${styles.form} appForm appSection`}>
          <label className={`${styles.label} appField`}>
            {isSv ? "Ticker" : "Ticker"}
            <TickerAutocomplete
              id="primersTicker"
              className={`${styles.input} appInput`}
              value={ticker}
              onChange={setTicker}
              placeholder={isSv ? "AAPL eller Apple" : "AAPL or Apple"}
              maxLength={48}
              required
            />
          </label>

          <button type="submit" className={`${styles.button} appButton`} disabled={loading}>
            {loading ? (isSv ? "Kör..." : "Running...") : isSv ? "Kör" : "Run"}
          </button>
        </form>

        {signedIn ? null : (
          <section className={`${styles.gateCard} appSection`} aria-live="polite">
            <p className={styles.gateText}>
              {signInPrompted
                ? isSv
                  ? "Skapa ett konto för att köra primern — den hämtar bolagets senaste rapport och sammanfattar den åt dig. Din ticker är kvar när du kommer tillbaka."
                  : "Create an account to run the primer — it fetches the company's latest filing and summarises it for you. Your ticker is kept for when you come back."
                : isSv
                  ? "En primer läser bolagets senaste rapport och ger dig en kort, tydlig sammanfattning. Skapa ett konto för att köra en — det tar under en minut."
                  : "A primer reads a company's latest filing and gives you a short, clear brief. Create an account to run one — it takes under a minute."}
            </p>
            <div className={styles.gateActions}>
              <Link className="appButton" href="/auth/login?mode=register&next=%2Fprimers">
                {isSv ? "Skapa konto" : "Create account"}
              </Link>
              <Link className={styles.gateLink} href="/auth/login?next=%2Fprimers">
                {isSv ? "Har du konto? Logga in" : "Have an account? Sign in"}
              </Link>
            </div>
          </section>
        )}

        {resumableJob ? (
          <section className={`${styles.resumeCard} appSection`} aria-live="polite">
            <p className={styles.resumeText}>
              {isSv ? "Tidigare Primer-jobb för" : "Previous Primer job for"} <strong>{resumableJob.ticker}</strong>{" "}
              {isSv
                ? resumableJob.status === "failed"
                  ? "misslyckades."
                  : `är fortfarande ${resumableJob.status}.`
                : resumableJob.status === "failed"
                  ? "failed."
                  : `still ${resumableJob.status}.`}
            </p>
            <div className={styles.resumeActions}>
              {resumableJob.status === "failed" ? (
                <button type="button" className="appButton" onClick={() => void onRetryResumable(resumableJob.id)} disabled={loading}>
                  {isSv ? "Försök igen" : "Retry job"}
                </button>
              ) : (
                <button type="button" className="appButton" onClick={() => void resumeJob(resumableJob.id)} disabled={loading}>
                  {isSv ? "Återuppta jobb" : "Resume job"}
                </button>
              )}
              {resumableJob.status !== "failed" ? (
                <button
                  type="button"
                  className="appButtonSecondary"
                  onClick={() => void onCancelResumable(resumableJob.id)}
                  disabled={loading}
                >
                  {isSv ? "Avbryt" : "Cancel"}
                </button>
              ) : null}
              <button
                type="button"
                className="appButtonSecondary"
                onClick={() =>
                  void (async () => {
                    try {
                      if (resumableJob.status === "failed") {
                        await dismissJob(resumableJob.id);
                      }
                      clearActiveJobId(resumableJob.id);
                      setResumableJob(null);
                    } catch (dismissError) {
                      setError(dismissError instanceof Error ? dismissError.message : isSv ? "Kunde inte dölja jobb" : "Could not dismiss job");
                    }
                  })()
                }
                disabled={loading}
              >
                {isSv ? "Stäng" : "Dismiss"}
              </button>
            </div>
          </section>
        ) : null}

        {loading ? (
          <section className={styles.loaderWrap} aria-live="polite" aria-busy="true">
            <div className={styles.loaderOrbit}>
              <span className={styles.loaderOrbiter}>
                <span className={styles.loaderDot} />
              </span>
            </div>
            <p className={styles.loaderText}>
              {jobStage === "queued"
                ? isSv ? "Köad..." : "Queued..."
                : jobStage === "fetching"
                  ? isSv ? "Hämtar rapportdata..." : "Fetching filing data..."
                  : isSv ? "Genererar primer..." : "Generating primer..."}
            </p>
          </section>
        ) : null}

        {error ? <UiState kind="error" message={error} className={styles.error} /> : null}

        {result ? (
          <section className={`${styles.results} appSection`}>
            <p className={`${styles.meta} appMeta`}>
              {isSv ? "Genererad för" : "Generated for"} <strong>{result.ticker}</strong>
              {result.form ? (
                <>
                  {" "}
                  | {isSv ? "Formulär" : "Form"}: <strong>{result.form}</strong>
                </>
              ) : null}
              {result.filing_date ? (
                <>
                  {" "}
                  | {isSv ? "Rapportdatum" : "Filing date"}: <strong>{result.filing_date}</strong>
                </>
              ) : null}
              {result.meta?.fallbackMode === "offline" ? ` | ${isSv ? "Offline-läge" : "Offline mode"}` : ""}
            </p>
            {pdfUrl ? (
              <div className={styles.linkWrap}>
                <a href={pdfUrl} target="_blank" rel="noreferrer" className={`${styles.openLink} appButtonSecondary`}>
                  {isSv ? "Öppna primer" : "Open Primer"}
                </a>
                {pdfDownloadUrl ? (
                  <a href={pdfDownloadUrl} className={`${styles.openLink} appButtonSecondary`}>
                    {isSv ? "Ladda ner PDF" : "Download PDF"}
                  </a>
                ) : null}
              </div>
            ) : null}

            {result.primer_text ? (
              <section className={styles.chatWrap}>
                <article className={styles.chatBubble}>
                  <p className={styles.chatText}>{typedPrimer}</p>
                </article>
              </section>
            ) : null}
          </section>
        ) : null}
      </Workspace>
    </main>
  );
}
