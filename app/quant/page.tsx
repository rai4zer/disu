"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import Workspace from "@/app/components/workspace";
import { resolveTickerSymbol } from "@/app/lib/ticker-suggestions";
import TickerAutocomplete from "@/app/components/ticker-autocomplete";
import ChartDownload from "@/app/components/chart-download";
import {
  cancelJob,
  dismissJob,
  getRecentJobs,
  pollJobResultWithProgress,
  retryJob
} from "@/app/lib/jobs/client";
import { useLanguage } from "@/app/i18n/language";
import UiState from "@/app/components/ui-state";

type QuantRow = {
  date: string;
  ticker: string;
  horizon: number;
  adj_close: number;
  pred_return: number;
  p_up_raw: number;
  p_up: number;
  implied_price: number;
  model_path: string;
};

type HistoryPoint = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adj_close: number;
  dividends: number;
};

type ReportPoint = {
  filedAt: string;
  form: "10-K" | "10-Q";
  quarter: "Q1" | "Q2" | "Q3" | "Q4" | null;
};

type QuantResponse =
  | {
      ok: true;
      ticker: string;
      rows: QuantRow[];
      history: HistoryPoint[];
      reports: ReportPoint[];
      meta?: {
        modelVersion: string;
        bridgeVersion: string;
        fallbackMode: "none" | "offline";
        cached?: boolean;
      };
    }
  | {
      ok: false;
      error: string;
      traceback?: string;
    };

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

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

type ResumableQuantJob = {
  id: string;
  ticker: string;
  status: "queued" | "running" | "failed";
  createdAt: string;
};

const ACTIVE_QUANT_JOB_KEY = "disu.jobs.quant.active";
const QUANT_TICKER_PREF_KEY = "pref.quant.ticker";
const QUANT_RANGE_PREF_KEY = "pref.quant.range";
const QUANT_CHART_MODE_PREF_KEY = "pref.quant.chart_mode";

type RangeKey = "1d" | "1w" | "1m" | "3m" | "ytd" | "1y" | "3y" | "5y" | "max";
type ChartMode = "sharp" | "smooth" | "candlestick" | "ohlc";

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: "1d", label: "1 day" },
  { key: "1w", label: "1 week" },
  { key: "1m", label: "1 month" },
  { key: "3m", label: "3 months" },
  { key: "ytd", label: "This year" },
  { key: "1y", label: "1 year" },
  { key: "3y", label: "3 years" },
  { key: "5y", label: "5 years" },
  { key: "max", label: "Max" }
];

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function fmtSignedPct(value: number): string {
  const pct = value * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function fmtPrice(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function linePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) {
    return "";
  }
  return points.map((point, idx) => `${idx === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function smoothLinePath(points: Array<{ x: number; y: number }>, tension = 0.2): string {
  if (points.length <= 2) {
    return linePath(points);
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    const cp1x = p1.x + ((p2.x - p0.x) / 6) * tension;
    const cp1y = p1.y + ((p2.y - p0.y) / 6) * tension;
    const cp2x = p2.x - ((p3.x - p1.x) / 6) * tension;
    const cp2y = p2.y - ((p3.y - p1.y) / 6) * tension;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function areaPath(points: Array<{ x: number; y: number }>, baselineY: number): string {
  if (points.length === 0) {
    return "";
  }
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath(points)} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
}

function pickBestHorizon(rows: QuantRow[]): number | null {
  if (rows.length === 0) {
    return null;
  }
  const best = rows.reduce((acc, row) => {
    const score = Math.abs(row.p_up - 0.5);
    const accScore = Math.abs(acc.p_up - 0.5);
    if (score > accScore) {
      return row;
    }
    if (score === accScore && row.horizon < acc.horizon) {
      return row;
    }
    return acc;
  }, rows[0]);
  return best.horizon;
}

function createIdempotencyKey(kind: "quant", ticker: string): string {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${kind}:${ticker}:${randomPart}`.slice(0, 128);
}

export default function QuantPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const [ticker, setTicker] = useState("");
  const [retrain, setRetrain] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<QuantRow[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [reports, setReports] = useState<ReportPoint[]>([]);
  const [resultMeta, setResultMeta] = useState<{
    modelVersion: string;
    bridgeVersion: string;
    fallbackMode: "none" | "offline";
    cached?: boolean;
  } | null>(null);
  const [activeHorizon, setActiveHorizon] = useState<number | null>(null);
  const [rangeKey, setRangeKey] = useState<RangeKey>("1w");
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number; date: string; price: number } | null>(null);
  const [ghostProjection, setGhostProjection] = useState<{ x: number; y: number; key: number } | null>(null);
  const [animatedProjection, setAnimatedProjection] = useState<{
    x: number;
    y: number;
    implied: number;
    predReturn: number;
    horizon: number;
  } | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("smooth");
  const [showHighLow, setShowHighLow] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [showDividends, setShowDividends] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [resumableJob, setResumableJob] = useState<ResumableQuantJob | null>(null);
  const [jobStage, setJobStage] = useState<"queued" | "fetching" | "running" | "done" | "failed">("queued");
  const [markerTooltip, setMarkerTooltip] = useState<{
    x: number;
    y: number;
    title: string;
    detail: string;
  } | null>(null);
  const rafRef = useRef<number | null>(null);
  const ghostTimerRef = useRef<number | null>(null);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const savedTicker = window.localStorage.getItem(QUANT_TICKER_PREF_KEY);
    const savedRange = window.localStorage.getItem(QUANT_RANGE_PREF_KEY);
    const savedChartMode = window.localStorage.getItem(QUANT_CHART_MODE_PREF_KEY);
    if (savedTicker) {
      setTicker(savedTicker);
    }
    if (savedRange && RANGE_OPTIONS.some((option) => option.key === savedRange)) {
      setRangeKey(savedRange as RangeKey);
    }
    if (savedChartMode && ["sharp", "smooth", "candlestick", "ohlc"].includes(savedChartMode)) {
      setChartMode(savedChartMode as ChartMode);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (ticker.trim()) {
      window.localStorage.setItem(QUANT_TICKER_PREF_KEY, ticker.trim().toUpperCase());
    }
  }, [ticker]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(QUANT_RANGE_PREF_KEY, rangeKey);
  }, [rangeKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(QUANT_CHART_MODE_PREF_KEY, chartMode);
  }, [chartMode]);
  const animatedRef = useRef<{
    x: number;
    y: number;
    implied: number;
    predReturn: number;
    horizon: number;
  } | null>(null);

  function readActiveJobId(): string {
    if (typeof window === "undefined") {
      return "";
    }
    return window.localStorage.getItem(ACTIVE_QUANT_JOB_KEY) ?? "";
  }

  function setActiveJobId(jobId: string): void {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ACTIVE_QUANT_JOB_KEY, jobId);
  }

  function clearActiveJobId(jobId?: string): void {
    if (typeof window === "undefined") {
      return;
    }
    const active = readActiveJobId();
    if (!jobId || active === jobId) {
      window.localStorage.removeItem(ACTIVE_QUANT_JOB_KEY);
    }
  }

  function applyQuantPayload(payload: QuantResponse): void {
    if (!payload.ok) {
      setRows([]);
      setHistory([]);
      setReports([]);
      setResultMeta(null);
      setActiveHorizon(null);
      setError(payload.error);
      return;
    }

    setRows(payload.rows);
    setHistory(payload.history ?? []);
    setReports(payload.reports ?? []);
    setResultMeta(payload.meta ?? null);
    setTicker(payload.ticker);
    const oneDay = payload.rows.find((row) => row.horizon === 1)?.horizon ?? null;
    setActiveHorizon(oneDay ?? pickBestHorizon(payload.rows));
    setRangeKey("1w");
    setHoverPoint(null);
    setMarkerTooltip(null);
  }

  async function resumeJob(jobId: string): Promise<void> {
    setLoading(true);
    setError(null);
    setJobStage("queued");
    setActiveJobId(jobId);
    try {
      const payload = await pollJobResultWithProgress<QuantResponse>(jobId, {
        attempts: 120,
        intervalMs: 2000,
        onProgress: (job) => {
          if (job.stage) {
            setJobStage(job.stage);
          }
        }
      });
      applyQuantPayload(payload);
      clearActiveJobId(jobId);
      setResumableJob(null);
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : isSv ? "Begäran misslyckades" : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = ticker.trim();
    let requestedTicker = (resolveTickerSymbol(trimmed) ?? trimmed.toUpperCase()).trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,12}$/.test(requestedTicker) && trimmed.length >= 2) {
      try {
        const response = await fetch(`/api/tickers/search?q=${encodeURIComponent(trimmed)}&limit=1`);
        const payload = (await response.json()) as { ok: boolean; suggestions?: Array<{ symbol?: string }> };
        if (payload.ok) {
          const firstSymbol = String(payload.suggestions?.[0]?.symbol ?? "").trim().toUpperCase();
          if (/^[A-Z0-9.\-]{1,12}$/.test(firstSymbol)) {
            requestedTicker = firstSymbol;
          }
        }
      } catch {
        // keep existing requestedTicker and let API validation handle invalid symbols.
      }
    }
    if (!requestedTicker) {
      return;
    }
    const currentTicker = rows[0]?.ticker ?? null;
    const isDifferentTicker = currentTicker !== null && currentTicker !== requestedTicker;

    if (isDifferentTicker) {
      setRows([]);
      setHistory([]);
      setReports([]);
      setResultMeta(null);
      setActiveHorizon(null);
      setHoverPoint(null);
      setGhostProjection(null);
      setAnimatedProjection(null);
      setMarkerTooltip(null);
      animatedRef.current = null;
    }

    setLoading(true);
    setError(null);
    setJobStage("queued");

    try {
      const response = await fetch("/api/quant/infer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ticker: requestedTicker,
          retrain,
          idempotencyKey: createIdempotencyKey("quant", requestedTicker)
        })
      });

      const queued = await parseJsonSafely<EnqueueResponse>(response);
      if (!queued?.ok) {
        setRows([]);
        setHistory([]);
        setReports([]);
        setActiveHorizon(null);
        const fallback = response.ok
          ? isSv
            ? "Tomt svar från Quant-kö-API."
            : "Unexpected empty response from quant enqueue endpoint."
          : isSv
            ? `Kunde inte köa Quant-jobb (${response.status}).`
            : `Quant enqueue failed (${response.status}).`;
        setError(queued?.error ?? fallback);
        return;
      }

      setActiveJobId(queued.jobId);
      const payload = await pollJobResultWithProgress<QuantResponse>(queued.jobId, {
        attempts: 120,
        intervalMs: 2000,
        onProgress: (job) => {
          if (job.stage) {
            setJobStage(job.stage);
          }
        }
      });
      applyQuantPayload(payload);
      clearActiveJobId(queued.jobId);
      setResumableJob(null);
    } catch (submitError) {
      setRows([]);
      setHistory([]);
      setReports([]);
      setResultMeta(null);
      setActiveHorizon(null);
      setHoverPoint(null);
      setMarkerTooltip(null);
      setError(submitError instanceof Error ? submitError.message : isSv ? "Begäran misslyckades" : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!toolMenuRef.current) {
        return;
      }
      if (!toolMenuRef.current.contains(event.target as Node)) {
        setToolsOpen(false);
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [isSv]);

  useEffect(() => {
    let cancelled = false;

    async function loadResumableJob(): Promise<void> {
      try {
        const jobs = await getRecentJobs("quant", 8);
        if (cancelled) {
          return;
        }

        const activeJobId = readActiveJobId();
        const activeMatch = jobs.find((job) => job.id === activeJobId && (job.status === "queued" || job.status === "running"));
        const fallbackMatch = jobs.find((job) => job.status === "queued" || job.status === "running");
        const failedMatch = jobs.find((job) => job.status === "failed");
        const match = activeMatch ?? fallbackMatch;

        if (!match && !failedMatch) {
          setResumableJob(null);
          return;
        }

        const chosen = match ?? failedMatch!;
        const tickerFromPayload =
          typeof chosen.payload?.ticker === "string"
            ? chosen.payload.ticker.trim().toUpperCase()
            : isSv
              ? "Okänd"
              : "Unknown";
        setResumableJob({
          id: chosen.id,
          ticker: tickerFromPayload || (isSv ? "Okänd" : "Unknown"),
          status: chosen.status === "running" ? "running" : chosen.status === "failed" ? "failed" : "queued",
          createdAt: chosen.createdAt ?? ""
        });
      } catch {
        // Keep page functional even if resume discovery fails.
      }
    }

    void loadResumableJob();
    return () => {
      cancelled = true;
    };
  }, [isSv]);

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

  const activeRow = useMemo(
    () => rows.find((row) => row.horizon === activeHorizon) ?? rows[0] ?? null,
    [activeHorizon, rows]
  );

  const rowInsights = useMemo(() => {
    if (rows.length === 0) {
      return [] as Array<{
        row: QuantRow;
        expectedReturn: number;
        rank: number;
        percentile: number;
      }>;
    }

    const withExpected = rows.map((row) => ({
      row,
      expectedReturn: row.pred_return * (2 * row.p_up - 1)
    }));

    const ranked = [...withExpected].sort((a, b) => b.expectedReturn - a.expectedReturn);
    const rankByHorizon = new Map<number, number>();
    ranked.forEach((item, index) => {
      rankByHorizon.set(item.row.horizon, index + 1);
    });

    const total = Math.max(1, rows.length);
    return withExpected.map((item) => {
      const rank = rankByHorizon.get(item.row.horizon) ?? total;
      const percentile = total === 1 ? 1 : (total - rank) / (total - 1);

      return {
        ...item,
        rank,
        percentile
      };
    });
  }, [rows]);

  const filteredHistory = useMemo(() => {
    if (history.length === 0) {
      return [] as Array<HistoryPoint & { ts: number }>;
    }
    const parsed = history
      .map((point) => ({ ...point, ts: new Date(point.date).getTime() }))
      .filter((point) => Number.isFinite(point.ts))
      .sort((a, b) => a.ts - b.ts);

    const lastTs = parsed[parsed.length - 1]?.ts ?? Date.now();
    const byCount = (count: number) => parsed.slice(Math.max(0, parsed.length - count));

    if (rangeKey === "1d") return byCount(1);
    if (rangeKey === "1w") return byCount(5);
    if (rangeKey === "1m") return byCount(21);
    if (rangeKey === "3m") return byCount(63);
    if (rangeKey === "1y") return byCount(252);
    if (rangeKey === "3y") return byCount(756);
    if (rangeKey === "5y") return byCount(1260);
    if (rangeKey === "ytd") {
      const lastDate = new Date(lastTs);
      const ytdStart = new Date(lastDate.getFullYear(), 0, 1).getTime();
      return parsed.filter((point) => point.ts >= ytdStart);
    }
    return parsed;
  }, [history, rangeKey]);

  const chartBase = useMemo(() => {
    if (filteredHistory.length === 0 || rows.length === 0) {
      return null;
    }

    const width = 860;
    const height = 280;
    const padLeft = 68;
    const padRight = 34;
    const padTop = 18;
    const padBottom = 30;

    const series = filteredHistory;
    const maxHorizon = Math.max(1, ...rows.map((row) => row.horizon));
    const combined = [
      ...series.flatMap((point) => [point.low, point.high, point.adj_close]),
      ...rows.map((row) => row.implied_price)
    ];
    const min = Math.min(...combined);
    const max = Math.max(...combined);
    const span = Math.max(0.0001, max - min);
    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;

    const xAt = (idx: number) => padLeft + (idx / Math.max(1, series.length - 1 + maxHorizon)) * plotWidth;
    const yAt = (price: number) => padTop + ((max - price) / span) * plotHeight;
    const historyRightX = xAt(Math.max(0, series.length - 1));
    const historyWidth = Math.max(1, historyRightX - padLeft);

    const pricePoints = series.map((point, idx) => ({
      x: xAt(idx),
      y: yAt(point.adj_close)
    }));

    const last = pricePoints[pricePoints.length - 1];
    const first = pricePoints[0];
    const sharpPath = linePath(pricePoints);
    const smoothPath = smoothLinePath(pricePoints, 0.26);
    const sharpAreaPath = areaPath(pricePoints, height - padBottom);
    const smoothAreaPath = `${smoothPath} L ${last.x} ${height - padBottom} L ${first.x} ${height - padBottom} Z`;

    const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
      const y = padTop + ratio * plotHeight;
      const value = max - ratio * span;
      return { id: idx, y, value };
    });
    const xGrid = [0, 0.2, 0.4, 0.6, 0.8, 1].map((ratio, idx) => ({
      id: idx,
      x: padLeft + ratio * plotWidth
    }));

    const candleSpacing = series.length > 1 ? Math.max(3, historyWidth / (series.length - 1)) : 10;
    const candleWidth = Math.max(2, Math.min(12, candleSpacing * 0.62));
    const candles = series.map((point, idx) => {
      const x = xAt(idx);
      return {
        x,
        date: point.date,
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
        openY: yAt(point.open),
        highY: yAt(point.high),
        lowY: yAt(point.low),
        closeY: yAt(point.close),
        adjY: yAt(point.adj_close),
        dividends: point.dividends
      };
    });

    const highPoint = series.reduce((acc, point) => (point.high > acc.high ? point : acc), series[0]);
    const lowPoint = series.reduce((acc, point) => (point.low < acc.low ? point : acc), series[0]);

    const dividendEvents = candles
      .filter((candle) => candle.dividends > 0)
      .map((candle) => {
        const bubbleY = Math.max(padTop + 11, candle.adjY - 20);
        return {
          ...candle,
          anchorY: candle.adjY,
          bubbleY
        };
      });

    const seriesWithTs = series.map((point, idx) => ({ idx, ts: point.ts }));
    const minTs = seriesWithTs[0]?.ts ?? Number.NEGATIVE_INFINITY;
    const maxTs = seriesWithTs[seriesWithTs.length - 1]?.ts ?? Number.POSITIVE_INFINITY;
    const reportEvents = reports
      .map((report) => {
        const reportTs = Date.parse(report.filedAt);
        if (!Number.isFinite(reportTs)) {
          return null;
        }
        // Only render filings that belong to the currently selected chart range.
        if (reportTs < minTs || reportTs > maxTs) {
          return null;
        }
        let nearest = seriesWithTs[0];
        for (let i = 1; i < seriesWithTs.length; i += 1) {
          const candidate = seriesWithTs[i];
          if (Math.abs(candidate.ts - reportTs) < Math.abs(nearest.ts - reportTs)) {
            nearest = candidate;
          }
        }
        const x = xAt(nearest.idx);
        const anchorY = yAt(series[nearest.idx].adj_close);
        const bubbleY = Math.max(padTop + 11, anchorY - 20);
        return {
          ...report,
          x,
          y: bubbleY,
          anchorY
        };
      })
      .filter((event): event is NonNullable<typeof event> => event !== null);

    return {
      padLeft,
      padRight,
      padTop,
      padBottom,
      plotWidth,
      width,
      height,
      sharpPath,
      smoothPath,
      sharpAreaPath,
      smoothAreaPath,
      lastX: last.x,
      lastY: last.y,
      latestClose: series[series.length - 1]?.adj_close ?? 0,
      seriesLength: series.length,
      xAt,
      yAt,
      series,
      candles,
      latestDate: series[series.length - 1]?.date,
      grid,
      xGrid,
      historyRightX,
      historyWidth,
      candleWidth,
      highPoint,
      lowPoint,
      dividendEvents,
      reportEvents
    };
  }, [filteredHistory, reports, rows]);

  const targetProjection = useMemo(() => {
    if (!chartBase || !activeRow) {
      return null;
    }

    return {
      x: chartBase.xAt(chartBase.seriesLength - 1 + activeRow.horizon),
      y: chartBase.yAt(activeRow.implied_price),
      implied: activeRow.implied_price,
      predReturn: activeRow.pred_return,
      horizon: activeRow.horizon
    };
  }, [activeRow, chartBase]);

  useEffect(() => {
    animatedRef.current = animatedProjection;
  }, [animatedProjection]);

  useEffect(() => {
    if (!targetProjection) {
      setAnimatedProjection(null);
      animatedRef.current = null;
      setGhostProjection(null);
      return;
    }

    if (!animatedRef.current) {
      setAnimatedProjection(targetProjection);
      animatedRef.current = targetProjection;
      return;
    }

    if (ghostTimerRef.current) {
      window.clearTimeout(ghostTimerRef.current);
      ghostTimerRef.current = null;
    }

    if (animatedRef.current) {
      setGhostProjection({
        x: animatedRef.current.x,
        y: animatedRef.current.y,
        key: Date.now()
      });
      ghostTimerRef.current = window.setTimeout(() => setGhostProjection(null), 420);
    }

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    const start = performance.now();
    const duration = 320;
    const from = animatedRef.current;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3);

      setAnimatedProjection({
        x: from.x + (targetProjection.x - from.x) * ease,
        y: from.y + (targetProjection.y - from.y) * ease,
        implied: from.implied + (targetProjection.implied - from.implied) * ease,
        predReturn: from.predReturn + (targetProjection.predReturn - from.predReturn) * ease,
        horizon: targetProjection.horizon
      });

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (ghostTimerRef.current) {
        window.clearTimeout(ghostTimerRef.current);
        ghostTimerRef.current = null;
      }
    };
  }, [targetProjection]);

  const rangeLabel = (label: string): string => {
    if (!isSv) {
      return label;
    }
    if (label === "1 day") return "1 dag";
    if (label === "1 week") return "1 vecka";
    if (label === "1 month") return "1 månad";
    if (label === "3 months") return "3 månader";
    if (label === "This year") return "I år";
    if (label === "1 year") return "1 år";
    if (label === "3 years") return "3 år";
    if (label === "5 years") return "5 år";
    return label;
  };

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Quant" : "Quant"}
        subtitle={isSv ? "Utforska kort- och medelfristiga prisscenarier för en ticker." : "Explore short- and medium-term price scenarios for a ticker."}
      >
        <form onSubmit={onSubmit} className={`${styles.form} appForm appSection`}>
          <label className={`${styles.label} appField`}>
            {isSv ? "Ticker" : "Ticker"}
            <TickerAutocomplete
              id="quantTicker"
              className={`${styles.input} appInput`}
              value={ticker}
              onChange={setTicker}
              placeholder={isSv ? "AAPL eller Apple" : "AAPL or Apple"}
              maxLength={48}
              required
            />
          </label>

          <label className={`${styles.checkboxRow} appCheckbox`}>
            <input type="checkbox" checked={retrain} onChange={(event) => setRetrain(event.target.checked)} />
            {isSv ? "Träna om modell" : "Retrain model"}
          </label>

          <div className={styles.actionsRow}>
            <button type="submit" className={`${styles.button} appButton`} disabled={loading}>
              {loading ? (isSv ? "Kör..." : "Running...") : isSv ? "Kör" : "Run"}
            </button>
          </div>
        </form>

        {resumableJob ? (
          <section className={`${styles.resumeCard} appSection`} aria-live="polite">
            <p className={styles.resumeText}>
              {isSv ? "Tidigare Quant-jobb för" : "Previous Quant job for"} <strong>{resumableJob.ticker}</strong>{" "}
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
                  ? isSv ? "Hämtar marknadsdata..." : "Fetching market data..."
                  : isSv ? "Kör Quant-analys..." : "Running quant inference..."}
            </p>
          </section>
        ) : null}

        {error ? <UiState kind="error" message={error} className={styles.error} /> : null}

        {rows.length > 0 ? (
          <section className={`${styles.results} appSection`}>
            <p className={`${styles.meta} appMeta`}>
              {isSv ? "Senaste datum" : "Latest date"}: <strong>{rows[0].date}</strong>
              {resultMeta?.fallbackMode === "offline" ? ` | ${isSv ? "Offline-läge" : "Offline mode"}` : ""}
            </p>

            {chartBase && animatedProjection ? (
              <div className={styles.chartCard}>
                <div className={styles.chartTopBar}>
                  <div className={styles.horizonTabs}>
                    {rows.map((row) => (
                      <button
                        key={row.horizon}
                        type="button"
                        className={`${styles.horizonTab} ${
                          row.horizon === activeRow?.horizon ? styles.horizonTabActive : ""
                        }`}
                        onClick={() => setActiveHorizon(row.horizon)}
                      >
                        {row.horizon}d
                      </button>
                    ))}
                  </div>

                  <div className={styles.chartActions}>
                    <ChartDownload symbol={rows[0].ticker} />

                    <div className={styles.toolMenuWrap} ref={toolMenuRef}>
                      <button
                        type="button"
                        className={styles.toolMenuButton}
                        onClick={() => setToolsOpen((open) => !open)}
                        aria-expanded={toolsOpen}
                        aria-haspopup="menu"
                        aria-label={isSv ? "Diagramverktyg" : "Chart tools"}
                      >
                        ⚙
                      </button>
                      {toolsOpen ? (
                        <div className={styles.toolMenu} role="menu">
                          <button
                            type="button"
                            className={`${styles.toolMenuItem} ${chartMode === "sharp" ? styles.toolMenuItemActive : ""}`}
                            onClick={() => {
                              setChartMode("sharp");
                              setToolsOpen(false);
                            }}
                          >
                            {isSv ? "Skarp graf" : "Sharp Graph"}
                          </button>
                          <button
                            type="button"
                            className={`${styles.toolMenuItem} ${chartMode === "smooth" ? styles.toolMenuItemActive : ""}`}
                            onClick={() => {
                              setChartMode("smooth");
                              setToolsOpen(false);
                            }}
                          >
                            {isSv ? "Mjuk graf" : "Smooth Graph"}
                          </button>
                          <button
                            type="button"
                            className={`${styles.toolMenuItem} ${
                              chartMode === "candlestick" ? styles.toolMenuItemActive : ""
                            }`}
                            onClick={() => {
                              setChartMode("candlestick");
                              setToolsOpen(false);
                            }}
                          >
                            Candlestick
                          </button>
                          <button
                            type="button"
                            className={`${styles.toolMenuItem} ${chartMode === "ohlc" ? styles.toolMenuItemActive : ""}`}
                            onClick={() => {
                              setChartMode("ohlc");
                              setToolsOpen(false);
                            }}
                          >
                            OHLC
                          </button>
                          <button
                            type="button"
                            className={`${styles.toolMenuItem} ${showHighLow ? styles.toolMenuItemActive : ""}`}
                            onClick={() => setShowHighLow((value) => !value)}
                          >
                            {isSv ? "Hög och låg" : "High and Low"}
                          </button>
                          <button
                            type="button"
                            className={`${styles.toolMenuItem} ${showReports ? styles.toolMenuItemActive : ""}`}
                            onClick={() => setShowReports((value) => !value)}
                          >
                            {isSv ? "Rapporter" : "Reports"}
                          </button>
                          <button
                            type="button"
                            className={`${styles.toolMenuItem} ${showDividends ? styles.toolMenuItemActive : ""}`}
                            onClick={() => setShowDividends((value) => !value)}
                          >
                            {isSv ? "Utdelningar" : "Dividends"}
                          </button>
                          <button
                            type="button"
                            className={`${styles.toolMenuItem} ${showGrid ? styles.toolMenuItemActive : ""}`}
                            onClick={() => setShowGrid((value) => !value)}
                          >
                            {isSv ? "Rutnät" : "Grid"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <svg
                  viewBox={`0 0 ${chartBase.width} ${chartBase.height}`}
                  className={styles.chartSvg}
                  role="img"
                  onMouseLeave={() => {
                    setHoverPoint(null);
                    setMarkerTooltip(null);
                  }}
                  onMouseMove={(event) => {
                    const svg = event.currentTarget;
                    const rect = svg.getBoundingClientRect();
                    const x = ((event.clientX - rect.left) / rect.width) * chartBase.width;
                    const clampedX = Math.max(chartBase.padLeft, Math.min(chartBase.historyRightX, x));
                    const relative = (clampedX - chartBase.padLeft) / chartBase.historyWidth;
                    const idx = Math.round(relative * Math.max(1, chartBase.series.length - 1));
                    const clamped = Math.max(0, Math.min(chartBase.series.length - 1, idx));
                    const point = chartBase.series[clamped];
                    const px = chartBase.xAt(clamped);
                    const py = chartBase.yAt(point.adj_close);
                    setHoverPoint({
                      x: px,
                      y: py,
                      date: point.date,
                      price: point.adj_close
                    });
                  }}
                >
                  {showGrid
                    ? chartBase.grid.map((line) => (
                        <g key={line.id}>
                          <line
                            className={styles.gridLine}
                            x1={chartBase.padLeft}
                            x2={chartBase.padLeft + chartBase.plotWidth}
                            y1={line.y}
                            y2={line.y}
                          />
                          <text className={styles.gridLabel} x={8} y={line.y + 4}>
                            {fmtPrice(line.value)}
                          </text>
                        </g>
                      ))
                    : null}
                  {showGrid
                    ? chartBase.xGrid.map((line) => (
                        <line
                          key={`x-grid-${line.id}`}
                          className={styles.xGridLine}
                          x1={line.x}
                          x2={line.x}
                          y1={chartBase.padTop}
                          y2={chartBase.height - chartBase.padBottom}
                        />
                      ))
                    : null}

                  <defs>
                    <linearGradient id="mountainGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4d8dff" stopOpacity="0.28" />
                      <stop offset="55%" stopColor="#6ca6ff" stopOpacity="0.12" />
                      <stop offset="100%" stopColor="#d0e2ff" stopOpacity="0" />
                    </linearGradient>
                  </defs>

                  {chartMode === "sharp" || chartMode === "smooth" ? (
                    <path
                      d={chartMode === "sharp" ? chartBase.sharpAreaPath : chartBase.smoothAreaPath}
                      className={styles.mountainArea}
                    />
                  ) : null}

                  {chartMode === "sharp" || chartMode === "smooth" ? (
                    <path
                      d={chartMode === "sharp" ? chartBase.sharpPath : chartBase.smoothPath}
                      className={styles.priceLine}
                      pathLength={1}
                    />
                  ) : null}

                  {chartMode === "candlestick"
                    ? chartBase.candles.map((candle) => {
                        const up = candle.close >= candle.open;
                        const bodyTop = Math.min(candle.openY, candle.closeY);
                        const bodyHeight = Math.max(1.4, Math.abs(candle.closeY - candle.openY));
                        return (
                          <g key={`${candle.date}-candle`}>
                            <line
                              className={styles.candleWick}
                              x1={candle.x}
                              x2={candle.x}
                              y1={candle.highY}
                              y2={candle.lowY}
                            />
                            <rect
                              className={up ? styles.candleBodyUp : styles.candleBodyDown}
                              x={candle.x - chartBase.candleWidth / 2}
                              y={bodyTop}
                              width={chartBase.candleWidth}
                              height={bodyHeight}
                              rx={1}
                            />
                          </g>
                        );
                      })
                    : null}

                  {chartMode === "ohlc"
                    ? chartBase.candles.map((candle) => (
                        <g key={`${candle.date}-ohlc`}>
                          <line className={styles.ohlcMain} x1={candle.x} x2={candle.x} y1={candle.highY} y2={candle.lowY} />
                          <line
                            className={styles.ohlcOpen}
                            x1={candle.x - chartBase.candleWidth / 2}
                            x2={candle.x}
                            y1={candle.openY}
                            y2={candle.openY}
                          />
                          <line
                            className={styles.ohlcClose}
                            x1={candle.x}
                            x2={candle.x + chartBase.candleWidth / 2}
                            y1={candle.closeY}
                            y2={candle.closeY}
                          />
                        </g>
                      ))
                    : null}

                  {showHighLow ? (
                    <g>
                      <line
                        className={styles.highLowLine}
                        x1={chartBase.padLeft}
                        x2={chartBase.padLeft + chartBase.plotWidth}
                        y1={chartBase.yAt(chartBase.highPoint.high)}
                        y2={chartBase.yAt(chartBase.highPoint.high)}
                      />
                      <line
                        className={styles.highLowLine}
                        x1={chartBase.padLeft}
                        x2={chartBase.padLeft + chartBase.plotWidth}
                        y1={chartBase.yAt(chartBase.lowPoint.low)}
                        y2={chartBase.yAt(chartBase.lowPoint.low)}
                      />
                      <text className={styles.highLowLabel} x={chartBase.padLeft + 8} y={chartBase.yAt(chartBase.highPoint.high) - 6}>
                        {isSv ? "Högsta" : "High"} {fmtPrice(chartBase.highPoint.high)}
                      </text>
                      <text className={styles.highLowLabel} x={chartBase.padLeft + 8} y={chartBase.yAt(chartBase.lowPoint.low) - 6}>
                        {isSv ? "Lägsta" : "Low"} {fmtPrice(chartBase.lowPoint.low)}
                      </text>
                    </g>
                  ) : null}

                  {showDividends
                    ? chartBase.dividendEvents.map((eventPoint) => (
                        <g key={`${eventPoint.date}-div`}>
                          <line
                            className={styles.dividendStem}
                            x1={eventPoint.x}
                            x2={eventPoint.x}
                            y1={eventPoint.anchorY}
                            y2={eventPoint.bubbleY + 7}
                          />
                          <circle
                            className={styles.dividendDot}
                            cx={eventPoint.x}
                            cy={eventPoint.bubbleY}
                            r={8}
                            onMouseEnter={() =>
                              setMarkerTooltip({
                                x: eventPoint.x,
                                y: eventPoint.bubbleY - 2,
                                title: isSv ? `Utdelning: ${fmtPrice(eventPoint.dividends)}` : `Dividend: ${fmtPrice(eventPoint.dividends)}`,
                                detail: isSv ? `Ex-datum ${eventPoint.date}` : `Ex-date ${eventPoint.date}`
                              })
                            }
                            onMouseLeave={() => setMarkerTooltip(null)}
                          />
                          <text className={styles.markerLabel} x={eventPoint.x} y={eventPoint.bubbleY + 3}>
                            U
                          </text>
                        </g>
                      ))
                    : null}

                  {showReports
                    ? chartBase.reportEvents.map((eventPoint) => (
                        <g key={`${eventPoint.form}-${eventPoint.filedAt}`}>
                          <line
                            className={styles.reportStem}
                            x1={eventPoint.x}
                            x2={eventPoint.x}
                            y1={eventPoint.anchorY}
                            y2={eventPoint.y + 7}
                          />
                          <circle
                            className={styles.reportDot}
                            cx={eventPoint.x}
                            cy={eventPoint.y}
                            r={8}
                            onMouseEnter={() =>
                              setMarkerTooltip({
                                x: eventPoint.x,
                                y: eventPoint.y - 2,
                                title: eventPoint.form,
                                detail:
                                  eventPoint.form === "10-Q" && eventPoint.quarter
                                    ? isSv
                                      ? `${eventPoint.quarter} • Rapporterad ${eventPoint.filedAt}`
                                      : `${eventPoint.quarter} • Filed ${eventPoint.filedAt}`
                                    : isSv
                                      ? `Rapporterad ${eventPoint.filedAt}`
                                      : `Filed ${eventPoint.filedAt}`
                              })
                            }
                            onMouseLeave={() => setMarkerTooltip(null)}
                          />
                          <text className={styles.markerLabel} x={eventPoint.x} y={eventPoint.y + 3}>
                            R
                          </text>
                        </g>
                      ))
                    : null}

                  {ghostProjection ? (
                    <path
                      key={ghostProjection.key}
                      d={`M ${chartBase.lastX} ${chartBase.lastY} L ${ghostProjection.x} ${ghostProjection.y}`}
                      className={styles.ghostProjectionLine}
                    />
                  ) : null}
                  <path
                    d={`M ${chartBase.lastX} ${chartBase.lastY} L ${animatedProjection.x} ${animatedProjection.y}`}
                    className={styles.projectionLine}
                  />
                  <circle cx={chartBase.lastX} cy={chartBase.lastY} r={4} className={styles.dotNow} />
                  <circle cx={animatedProjection.x} cy={animatedProjection.y} r={5} className={styles.dotProj} />
                  {hoverPoint ? (
                    <g>
                      <line
                        className={styles.hoverLine}
                        x1={hoverPoint.x}
                        x2={hoverPoint.x}
                        y1={chartBase.padTop}
                        y2={chartBase.height - chartBase.padBottom}
                      />
                      <circle cx={hoverPoint.x} cy={hoverPoint.y} r={4} className={styles.dotHover} />
                    </g>
                  ) : null}
                  {markerTooltip ? (
                    <g transform={`translate(${markerTooltip.x + 8} ${markerTooltip.y - 26})`} pointerEvents="none">
                      <rect className={styles.markerTipBg} width="150" height="34" rx="6" />
                      <text className={styles.markerTipTitle} x="8" y="13">
                        {markerTooltip.title}
                      </text>
                      <text className={styles.markerTipDetail} x="8" y="26">
                        {markerTooltip.detail}
                      </text>
                    </g>
                  ) : null}
                </svg>

                <div className={styles.rangeTabs}>
                  {RANGE_OPTIONS.map((range) => (
                    <button
                      key={range.key}
                      type="button"
                      className={`${styles.rangeTab} ${range.key === rangeKey ? styles.rangeTabActive : ""}`}
                      onClick={() => setRangeKey(range.key)}
                    >
                      {rangeLabel(range.label)}
                    </button>
                  ))}
                </div>

                <div className={styles.chartLegend}>
                  <span>
                    {hoverPoint
                      ? `${hoverPoint.date} • ${fmtPrice(hoverPoint.price)}`
                      : `${isSv ? "Historik" : "History"}: ${rangeLabel(RANGE_OPTIONS.find((r) => r.key === rangeKey)?.label ?? "")}`}
                  </span>
                  <span>
                    {isSv ? "Horisont" : "Horizon"} {animatedProjection.horizon}d: {isSv ? "implicit" : "implied"}{" "}
                    {fmtPrice(animatedProjection.implied)} (
                    {fmtPct(animatedProjection.predReturn)})
                  </span>
                </div>
              </div>
            ) : null}

            <div className={`${styles.tableWrap} appTableWrap`}>
              <table className={`${styles.table} appTable`}>
                <thead>
                  <tr>
                    <th>{isSv ? "Horisont" : "Horizon"}</th>
                    <th>{isSv ? "Justerad stängning" : "Adj Close"}</th>
                    <th>{isSv ? "Prognosavkastning" : "Pred Return"}</th>
                    <th>{isSv ? "Sannolikhet upp" : "Prob Up"}</th>
                    <th>{isSv ? "Implicit pris" : "Implied Price"}</th>
                    <th>{isSv ? "Förväntad avkastning" : "Expected Return"}</th>
                  </tr>
                </thead>
                <tbody>
                  {rowInsights.map(({ row, expectedReturn, rank, percentile }) => (
                    <tr key={row.horizon} className={styles.tableRow}>
                      <td>{row.horizon}d</td>
                      <td>{fmtPrice(row.adj_close)}</td>
                      <td className={row.pred_return >= 0 ? styles.metricPositive : styles.metricNegative}>
                        {fmtSignedPct(row.pred_return)}
                      </td>
                      <td>{fmtPct(row.p_up)}</td>
                      <td>{fmtPrice(row.implied_price)}</td>
                      <td className={expectedReturn >= 0 ? styles.metricPositive : styles.metricNegative}>
                        <div className={styles.expectedWrap}>
                          <span className={styles.rankBadge}>#{rank}</span>
                          <span className={styles.expectedValue}>{fmtSignedPct(expectedReturn)}</span>
                          <span className={styles.expectedMeter} aria-hidden="true">
                            <span
                              className={`${styles.expectedFill} ${
                                expectedReturn >= 0 ? styles.expectedFillPositive : styles.expectedFillNegative
                              }`}
                              style={{ width: `${Math.max(8, Math.round(percentile * 100))}%` }}
                            />
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </Workspace>
    </main>
  );
}
