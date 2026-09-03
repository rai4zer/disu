"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/app/i18n/language";
import styles from "./chart-download.module.css";

export type DownloadPreset = "1mo" | "6mo" | "ytd" | "1y" | "5y" | "10y" | "max" | "custom";
type Interval = "1d" | "1wk" | "1mo";
type Format = "csv" | "xlsx";

/** The oldest date Yahoo has any listing for; "Max" starts here and gets clipped upstream. */
const MAX_START = "1962-01-02";
const MS_PER_DAY = 86_400_000;

function today(): string {
  return new Date(Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY).toISOString().slice(0, 10);
}

function presetStart(preset: Exclude<DownloadPreset, "custom">): string {
  if (preset === "max") {
    return MAX_START;
  }
  const now = new Date(Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY);
  const start = new Date(now.getTime());
  if (preset === "ytd") {
    return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10);
  }
  if (preset === "1mo") {
    start.setUTCMonth(start.getUTCMonth() - 1);
  } else if (preset === "6mo") {
    start.setUTCMonth(start.getUTCMonth() - 6);
  } else if (preset === "1y") {
    start.setUTCFullYear(start.getUTCFullYear() - 1);
  } else if (preset === "5y") {
    start.setUTCFullYear(start.getUTCFullYear() - 5);
  } else {
    start.setUTCFullYear(start.getUTCFullYear() - 10);
  }
  return start.toISOString().slice(0, 10);
}

/**
 * Download control for a price chart: the reader picks a period, a granularity,
 * dividends on or off, and gets a CSV or an .xlsx of the real series.
 *
 * Shared by every stock chart in the app, so the options and the wording only
 * exist in one place.
 */
export default function ChartDownload({
  symbol,
  defaultPreset = "1y",
  className
}: {
  symbol: string;
  /** Usually derived from the range the chart is showing. */
  defaultPreset?: DownloadPreset;
  className?: string;
}) {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const panelId = useId();

  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<DownloadPreset>(defaultPreset);
  const [from, setFrom] = useState(() => presetStart(defaultPreset === "custom" ? "1y" : defaultPreset));
  const [to, setTo] = useState(today);
  const [granularity, setGranularity] = useState<Interval>("1d");
  const [dividends, setDividends] = useState(false);
  const [format, setFormat] = useState<Format>("xlsx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choosePreset = (next: DownloadPreset) => {
    setPreset(next);
    setError(null);
    if (next !== "custom") {
      setFrom(presetStart(next));
      setTo(today());
    }
  };

  const presets = useMemo(
    () => [
      { key: "1mo" as const, label: isSv ? "1 mån" : "1M" },
      { key: "6mo" as const, label: isSv ? "6 mån" : "6M" },
      { key: "ytd" as const, label: isSv ? "I år" : "YTD" },
      { key: "1y" as const, label: isSv ? "1 år" : "1Y" },
      { key: "5y" as const, label: isSv ? "5 år" : "5Y" },
      { key: "10y" as const, label: isSv ? "10 år" : "10Y" },
      { key: "max" as const, label: "MAX" },
      { key: "custom" as const, label: isSv ? "Egen" : "Custom" }
    ],
    [isSv]
  );

  const download = useCallback(async () => {
    if (from > to) {
      setError(isSv ? "Startdatumet ligger efter slutdatumet." : "The start date is after the end date.");
      return;
    }
    setBusy(true);
    setError(null);

    const query = new URLSearchParams({
      symbol,
      from,
      to,
      interval: granularity,
      format,
      dividends: dividends ? "1" : "0",
      lang: isSv ? "sv" : "en"
    });

    try {
      const response = await fetch(`/api/tickers/history/download?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error ?? (isSv ? "Nedladdningen misslyckades." : "The download failed."));
      }

      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = match?.[1] ?? `${symbol.toLowerCase()}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoking immediately can cancel the download in Safari.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : isSv ? "Okänt fel" : "Unknown error");
    } finally {
      setBusy(false);
    }
  }, [dividends, format, from, granularity, isSv, symbol, to]);

  return (
    <div className={`${styles.wrap} ${className ?? ""}`} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
          <path
            d="M8 1.5v8.2M4.8 6.8 8 10l3.2-3.2M2.5 12.8h11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {isSv ? "Ladda ner" : "Download"}
      </button>

      {open ? (
        <div
          id={panelId}
          className={styles.panel}
          role="dialog"
          aria-label={isSv ? `Ladda ner kurshistorik för ${symbol}` : `Download price history for ${symbol}`}
        >
          <p className={styles.panelTitle}>{isSv ? "Kurshistorik" : "Price history"}</p>

          <fieldset className={styles.field}>
            <legend className={styles.legend}>{isSv ? "Period" : "Period"}</legend>
            <div className={styles.chips}>
              {presets.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`${styles.chip} ${preset === option.key ? styles.chipActive : ""}`}
                  onClick={() => choosePreset(option.key)}
                  aria-pressed={preset === option.key}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className={styles.dates}>
              <label className={styles.dateLabel}>
                {isSv ? "Från" : "From"}
                <input
                  type="date"
                  className={styles.date}
                  value={from}
                  max={to}
                  onChange={(event) => {
                    setFrom(event.target.value);
                    setPreset("custom");
                    setError(null);
                  }}
                />
              </label>
              <label className={styles.dateLabel}>
                {isSv ? "Till" : "To"}
                <input
                  type="date"
                  className={styles.date}
                  value={to}
                  min={from}
                  max={today()}
                  onChange={(event) => {
                    setTo(event.target.value);
                    setPreset("custom");
                    setError(null);
                  }}
                />
              </label>
            </div>
          </fieldset>

          <fieldset className={styles.field}>
            <legend className={styles.legend}>{isSv ? "Upplösning" : "Granularity"}</legend>
            <div className={styles.chips}>
              {(
                [
                  { key: "1d" as const, label: isSv ? "Dag" : "Daily" },
                  { key: "1wk" as const, label: isSv ? "Vecka" : "Weekly" },
                  { key: "1mo" as const, label: isSv ? "Månad" : "Monthly" }
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`${styles.chip} ${granularity === option.key ? styles.chipActive : ""}`}
                  onClick={() => setGranularity(option.key)}
                  aria-pressed={granularity === option.key}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className={styles.checkbox}>
            <input type="checkbox" checked={dividends} onChange={(event) => setDividends(event.target.checked)} />
            <span>
              {isSv ? "Inkludera utdelningar" : "Include dividends"}
              <span className={styles.hint}>
                {isSv
                  ? "Lägger till utdelning per period och en utdelningsjusterad stängningskurs."
                  : "Adds the dividend paid in each period and a dividend-adjusted close."}
              </span>
            </span>
          </label>

          <fieldset className={styles.field}>
            <legend className={styles.legend}>{isSv ? "Format" : "Format"}</legend>
            <div className={styles.chips}>
              {(
                [
                  { key: "xlsx" as const, label: "Excel (.xlsx)" },
                  { key: "csv" as const, label: "CSV" }
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`${styles.chip} ${format === option.key ? styles.chipActive : ""}`}
                  onClick={() => setFormat(option.key)}
                  aria-pressed={format === option.key}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          <button type="button" className={styles.submit} onClick={() => void download()} disabled={busy}>
            {busy
              ? isSv
                ? "Hämtar…"
                : "Preparing…"
              : isSv
                ? `Ladda ner ${format === "xlsx" ? ".xlsx" : "CSV"}`
                : `Download ${format === "xlsx" ? ".xlsx" : "CSV"}`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
