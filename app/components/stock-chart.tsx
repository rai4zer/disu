"use client";

import {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useLanguage } from "@/app/i18n/language";
import ChartDownload, { type DownloadPreset } from "./chart-download";
import styles from "./stock-chart.module.css";
import { NUMBER_LOCALE } from "@/app/lib/format/number";

type Candle = {
  t: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

type HistoryMeta = {
  symbol: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  timezone: string | null;
  price: number | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  volume: number | null;
};

type RangeKey = "1d" | "5d" | "1mo" | "6mo" | "ytd" | "1y" | "5y" | "max";

/**
 * One horizon of a quant run, as the chart needs it.
 *
 * Structurally the quant row (`use-tool-runs.ts`) minus the fields the drawing
 * does not read. Declared here rather than imported so a dashboard chart never
 * pulls the instrument page's job client in behind it.
 */
export type ProjectionPoint = {
  horizon: number;
  pred_return: number;
  p_up: number;
  implied_price: number;
};

type HistoryPayload = {
  ok: boolean;
  error?: string;
  range?: RangeKey;
  intraday?: boolean;
  meta?: HistoryMeta;
  candles?: Candle[];
};

const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: "1d", label: "1D" },
  { key: "5d", label: "5D" },
  { key: "1mo", label: "1M" },
  { key: "6mo", label: "6M" },
  { key: "ytd", label: "YTD" },
  { key: "1y", label: "1Y" },
  { key: "5y", label: "5Y" },
  { key: "max", label: "MAX" }
];

// The download panel opens on the period closest to what the chart is showing.
// Intraday ranges have no daily-bar equivalent, so they fall back to a month.
const DOWNLOAD_PRESETS: Record<RangeKey, DownloadPreset> = {
  "1d": "1mo",
  "5d": "1mo",
  "1mo": "1mo",
  "6mo": "6mo",
  ytd: "ytd",
  "1y": "1y",
  "5y": "5y",
  max: "max"
};

const OVERLAYS = [
  { key: "sma50" as const, period: 50, color: "var(--chart-sma-50)", label: "SMA 50" },
  { key: "sma200" as const, period: 200, color: "var(--chart-sma-200)", label: "SMA 200" }
];

// The SVG is drawn in real CSS pixels (measured from the container) instead of a
// stretched viewBox — a non-uniform viewBox would squash the axis text and make
// candle wicks thicker than the price line.
const PAD = { top: 16, right: 60, bottom: 22, left: 8 };
const VOL_RATIO = 0.2;
const PANEL_GAP = 12;

// --- history cache --------------------------------------------------------
//
// A range switch should feel like a tab switch, not a page load. Every response
// is kept per symbol+range for as long as it is worth trusting (a minute for
// intraday bars, five for daily ones), so going back to a range you have
// already seen — or reopening the same instrument — paints from memory with no
// skeleton and no request. Concurrent asks for the same key share one request,
// which is what makes hover-prefetching free: by the time the click lands the
// promise is usually already resolved.

type CacheEntry = { payload: HistoryPayload; at: number };

const historyCache = new Map<string, CacheEntry>();
const historyInFlight = new Map<string, Promise<HistoryPayload>>();

const INTRADAY_TTL_MS = 60_000;
const DAILY_TTL_MS = 5 * 60_000;

function cacheKey(symbol: string, range: RangeKey): string {
  return `${symbol.toUpperCase()}|${range}`;
}

function readHistoryCache(symbol: string, range: RangeKey): HistoryPayload | null {
  const key = cacheKey(symbol, range);
  const entry = historyCache.get(key);
  if (!entry) {
    return null;
  }
  const ttl = entry.payload.intraday ? INTRADAY_TTL_MS : DAILY_TTL_MS;
  if (Date.now() - entry.at > ttl) {
    historyCache.delete(key);
    return null;
  }
  return entry.payload;
}

function loadHistory(symbol: string, range: RangeKey, fallbackError: string): Promise<HistoryPayload> {
  const key = cacheKey(symbol, range);
  const pending = historyInFlight.get(key);
  if (pending) {
    return pending;
  }
  // Deliberately not `no-store`: the route ships a short max-age, so a reload or
  // a second chart on the same symbol can be served by the browser cache.
  const request = fetch(`/api/tickers/history?symbol=${encodeURIComponent(symbol)}&range=${range}`)
    .then(async (response) => {
      const json = (await response.json()) as HistoryPayload;
      if (!response.ok || !json.ok || !Array.isArray(json.candles) || json.candles.length === 0) {
        throw new Error(json.error ?? fallbackError);
      }
      historyCache.set(key, { payload: json, at: Date.now() });
      return json;
    })
    .finally(() => {
      historyInFlight.delete(key);
    });
  historyInFlight.set(key, request);
  return request;
}

// Warm a range without caring about the outcome — a failed prefetch is simply
// the request the click would have made anyway.
function prefetchHistory(symbol: string, range: RangeKey): void {
  if (readHistoryCache(symbol, range)) {
    return;
  }
  void loadHistory(symbol, range, "").catch(() => undefined);
}

// SSR renders this component too, and useLayoutEffect warns there.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function plotHeightFor(width: number, dense: boolean): number {
  if (dense) {
    return width < 560 ? 220 : width < 820 ? 264 : 296;
  }
  return width < 560 ? 260 : width < 820 ? 320 : 380;
}

function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (values.length < period) {
    return out;
  }
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= period) {
      sum -= values[index - period];
    }
    if (index >= period - 1) {
      out[index] = sum / period;
    }
  }
  return out;
}

// Axis labels land on round numbers rather than on the raw data extremes.
function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return [];
  }
  const rawStep = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step =
    (normalized >= 5 ? 10 : normalized >= 2.5 ? 5 : normalized >= 1.2 ? 2.5 : normalized >= 1 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 0.001; value += step) {
    ticks.push(Math.round(value / step) * step);
  }
  return ticks;
}

// Axis labels only need enough precision to separate the gridlines...
function axisDecimalsFor(span: number): number {
  if (span >= 100) return 0;
  if (span >= 10) return 1;
  if (span >= 1) return 2;
  if (span >= 0.1) return 3;
  return 4;
}

// ...while quoted prices keep the precision the instrument is actually traded at.
function priceDecimalsFor(price: number): number {
  const magnitude = Math.abs(price);
  if (magnitude >= 1) return 2;
  if (magnitude >= 0.01) return 4;
  return 6;
}

/**
 * `dense` is the instrument page's variant: that page runs the chart in a
 * column beside a trade ticket rather than across the full width, so it asks
 * for tighter chrome and a shorter plot than the dashboard's hero chart. The
 * height curve stays width-driven either way — only the constants change.
 */
export default function StockChart({
  symbol,
  name,
  dense = false,
  projection = null
}: {
  symbol: string;
  name?: string | null;
  dense?: boolean;
  /**
   * A quant run to draw past the last candle. The chart does not fetch it and
   * does not know how it was produced — the page owns the run and hands the
   * horizons down, which is why the same numbers can appear here, in the rail
   * and in the Quant tab without three jobs being queued.
   */
  projection?: ProjectionPoint[] | null;
}) {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const locale = isSv ? "sv-SE" : "en-US";

  const [range, setRange] = useState<RangeKey>("6mo");
  const [chartStyle, setChartStyle] = useState<"area" | "candle">("area");
  const [overlays, setOverlays] = useState<Record<"sma50" | "sma200", boolean>>({ sma50: false, sma200: false });
  const [payload, setPayload] = useState<HistoryPayload | null>(() => readHistoryCache(symbol, range));
  const [loading, setLoading] = useState(() => readHistoryCache(symbol, range) === null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Two readings of one projection: the extended graph, and the table of what
  // each day is worth. The toggle only exists once there is a run to read.
  const [view, setView] = useState<"chart" | "table">("chart");
  const [size, setSize] = useState(() => ({ width: 960, height: plotHeightFor(960, dense) }));
  const plotRef = useRef<HTMLDivElement | null>(null);

  // Measured before the browser paints, so the chart's first frame is already at
  // its real width. Measuring in a passive effect drew the SVG once at the 960px
  // guess and then snapped it into place, which read as the chart arriving late.
  useIsomorphicLayoutEffect(() => {
    const node = plotRef.current;
    if (!node) {
      return;
    }
    const apply = (rawWidth: number) => {
      const width = Math.round(rawWidth);
      if (width <= 0) {
        return;
      }
      setSize((current) =>
        current.width === width ? current : { width, height: plotHeightFor(width, dense) }
      );
    };

    apply(node.getBoundingClientRect().width);

    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => apply(entries[0]?.contentRect.width ?? 0));
    observer.observe(node);
    return () => observer.disconnect();
  }, [dense]);

  useEffect(() => {
    setError(null);
    setHover(null);

    const cached = readHistoryCache(symbol, range);
    if (cached) {
      setPayload(cached);
      setLoading(false);
      return;
    }

    // The request is never aborted, only disowned: a range you flicked past
    // still lands in the cache, so coming back to it costs nothing.
    let current = true;
    setLoading(true);
    loadHistory(symbol, range, isSv ? "Kursdata saknas" : "Price history unavailable")
      .then((json) => {
        if (!current) {
          return;
        }
        setPayload(json);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!current) {
          return;
        }
        setPayload(null);
        setError(err instanceof Error ? err.message : isSv ? "Okänt fel" : "Unknown error");
        setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [isSv, range, symbol]);

  // Once the range on screen is settled, quietly warm the two ranges either side
  // of it in the tab strip. Hover-prefetch covers the mouse; this is what makes
  // the first tap on a touch screen feel the same.
  useEffect(() => {
    if (loading || !payload) {
      return;
    }
    const position = RANGES.findIndex((option) => option.key === range);
    const neighbours = [RANGES[position - 1], RANGES[position + 1]].filter(
      (option): option is (typeof RANGES)[number] => Boolean(option)
    );
    const idle = window.setTimeout(() => {
      neighbours.forEach((option) => prefetchHistory(symbol, option.key));
    }, 400);
    return () => window.clearTimeout(idle);
  }, [loading, payload, range, symbol]);

  // A projection is quoted in trading days, so it needs a daily axis to land
  // on. Arriving while the reader is on 1D or 5D moves them to 1M once — not on
  // every render, or switching back to 1D on purpose would be undone.
  const projectionRows = useMemo(
    () =>
      (projection ?? [])
        .filter((point) => Number.isFinite(point.implied_price) && point.horizon >= 1)
        .sort((a, b) => a.horizon - b.horizon),
    [projection]
  );
  const hasProjection = projectionRows.length > 0;
  const projectionSeen = useRef(false);
  useEffect(() => {
    if (!hasProjection) {
      projectionSeen.current = false;
      setView("chart");
      return;
    }
    if (projectionSeen.current) {
      return;
    }
    projectionSeen.current = true;
    setRange((current) => (current === "1d" || current === "5d" ? "1mo" : current));
  }, [hasProjection]);

  const candles = useMemo(() => payload?.candles ?? [], [payload]);
  const meta = payload?.meta ?? null;
  const intraday = payload?.intraday ?? false;

  const geometry = useMemo(() => {
    if (candles.length === 0) {
      return null;
    }

    const { width, height } = size;
    const volumeHeight = Math.round(height * VOL_RATIO);
    const plotLeft = PAD.left;
    const plotRight = Math.max(plotLeft + 40, width - PAD.right);
    const priceTop = PAD.top;
    const priceBottom = height - PAD.bottom - volumeHeight - PANEL_GAP;
    const volumeTop = height - PAD.bottom - volumeHeight;
    const volumeBottom = height - PAD.bottom;

    const closes = candles.map((candle) => candle.close);
    // Intraday charts are read against yesterday's close, so it has to fit in the scale.
    const baseline = intraday ? meta?.previousClose ?? null : null;

    // The projection is quoted in trading days, so it can only be drawn against
    // a daily axis. On an intraday range the horizons have nowhere to land, and
    // pretending otherwise would put "ten days" inside one afternoon — the run
    // is kept, the drawing is not (the range switch is handled in an effect).
    const horizons = (projection ?? [])
      .filter((point) => Number.isFinite(point.implied_price) && point.horizon >= 1)
      .sort((a, b) => a.horizon - b.horizon);
    const projecting = !intraday && horizons.length > 0;
    const futureSlots = projecting ? horizons[horizons.length - 1].horizon : 0;

    const lows = chartStyle === "candle" ? candles.map((c) => c.low ?? c.close) : closes;
    const highs = chartStyle === "candle" ? candles.map((c) => c.high ?? c.close) : closes;
    const overlaySeries = OVERLAYS.filter((overlay) => overlays[overlay.key]).map((overlay) => ({
      ...overlay,
      values: sma(closes, overlay.period)
    }));
    const overlayValues = overlaySeries
      .flatMap((overlay) => overlay.values)
      .filter((value): value is number => value !== null);

    // Implied prices join the scale, or a projection that runs above the period
    // high would be drawn flat against the top of the plot.
    const implied = projecting ? horizons.map((point) => point.implied_price) : [];

    let min = Math.min(...lows, ...overlayValues, ...implied, ...(baseline !== null ? [baseline] : []));
    let max = Math.max(...highs, ...overlayValues, ...implied, ...(baseline !== null ? [baseline] : []));
    if (max === min) {
      min -= Math.abs(min) * 0.01 || 1;
      max += Math.abs(max) * 0.01 || 1;
    }
    const headroom = (max - min) * 0.06;
    min -= headroom;
    max += headroom;

    // History and the horizon share one x scale: the ten future slots are part
    // of the divisor, so running a projection compresses the history to the
    // left rather than overflowing the plot on the right.
    const step = (plotRight - plotLeft) / (candles.length + futureSlots);
    const x = (index: number) => plotLeft + step * (index + 0.5);
    const y = (value: number) => priceBottom - ((value - min) / (max - min)) * (priceBottom - priceTop);

    const volumeMax = Math.max(...candles.map((candle) => candle.volume ?? 0), 1);
    const volumeY = (value: number) => volumeBottom - (value / volumeMax) * (volumeBottom - volumeTop);

    const linePath = candles
      .map((candle, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)} ${y(candle.close).toFixed(2)}`)
      .join(" ");
    const areaPath = `${linePath} L${x(candles.length - 1).toFixed(2)} ${priceBottom.toFixed(2)} L${x(0).toFixed(2)} ${priceBottom.toFixed(2)} Z`;

    const smaPaths = overlaySeries.map((overlay) => {
      let path = "";
      let open = false;
      overlay.values.forEach((value, index) => {
        if (value === null) {
          open = false;
          return;
        }
        path += `${open ? "L" : "M"}${x(index).toFixed(2)} ${y(value).toFixed(2)} `;
        open = true;
      });
      return { key: overlay.key, color: overlay.color, label: overlay.label, path: path.trim(), ready: path.length > 0 };
    });

    // Drawn from the last real close, so the dashed leg starts where the solid
    // line stops instead of floating a day away from it.
    const lastClose = closes[closes.length - 1];
    const lastIndex = candles.length - 1;
    const projectionShape = projecting
      ? (() => {
          const points = horizons.map((point) => ({
            ...point,
            cx: x(lastIndex + point.horizon),
            cy: y(point.implied_price)
          }));
          const head = `M${x(lastIndex).toFixed(2)} ${y(lastClose).toFixed(2)}`;
          const tail = points.map((point) => `L${point.cx.toFixed(2)} ${point.cy.toFixed(2)}`).join(" ");
          const path = `${head} ${tail}`;
          const last = points[points.length - 1];
          const todayY = y(lastClose);
          return {
            path,
            // Closed against today's price rather than the foot of the plot: the
            // band is then the projected move itself, and a 2% projection stops
            // painting a fifth of the chart teal.
            area: `${path} L${last.cx.toFixed(2)} ${todayY.toFixed(2)} L${x(lastIndex).toFixed(2)} ${todayY.toFixed(2)} Z`,
            points,
            todayY,
            // Above the highest point of the projection, so the readout never
            // sits on the line it describes.
            labelY: Math.max(priceTop + 11, Math.min(...points.map((point) => point.cy)) - 9),
            // The seam between what happened and what is modelled. Half a slot
            // past the last candle's centre, which is where the bar would end.
            splitX: plotLeft + step * (lastIndex + 1),
            end: last,
            rising: last.implied_price >= lastClose
          };
        })()
      : null;

    const priceTicks = niceTicks(min, max, height < 300 ? 3 : 4);
    const tickCount = Math.min(width < 560 ? 4 : 6, candles.length);
    const timeTicks = Array.from({ length: tickCount }, (_, slot) =>
      Math.round((slot * (candles.length - 1)) / Math.max(1, tickCount - 1))
    ).filter((index, slot, list) => list.indexOf(index) === slot);

    return {
      width,
      height,
      plotLeft,
      plotRight,
      priceTop,
      priceBottom,
      volumeTop,
      volumeBottom,
      min,
      max,
      axisDecimals: axisDecimalsFor(max - min),
      priceDecimals: priceDecimalsFor(closes[closes.length - 1]),
      step,
      x,
      y,
      volumeY,
      volumeMax,
      linePath,
      areaPath,
      smaPaths,
      priceTicks,
      timeTicks,
      baseline,
      projection: projectionShape,
      first: closes[0],
      last: closes[closes.length - 1]
    };
  }, [candles, chartStyle, intraday, meta, overlays, projection, size]);

  const periodChange = useMemo(() => {
    if (!geometry) {
      return null;
    }
    const from = intraday ? geometry.baseline ?? geometry.first : geometry.first;
    if (!Number.isFinite(from) || from === 0) {
      return null;
    }
    const absolute = geometry.last - from;
    return { absolute, percent: (absolute / from) * 100 };
  }, [geometry, intraday]);

  const formatPrice = useCallback(
    (value: number | null | undefined, digits?: number) => {
      if (value === null || value === undefined || !Number.isFinite(value)) {
        return "-";
      }
      const fraction = digits ?? geometry?.priceDecimals ?? 2;
      return value.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: fraction, maximumFractionDigits: fraction });
    },
    [geometry]
  );

  const formatVolume = useCallback(
    (value: number | null | undefined) => {
      if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
        return "-";
      }
      const units: Array<[number, string]> = [
        [1e9, isSv ? "mdr" : "B"],
        [1e6, isSv ? "mn" : "M"],
        [1e3, isSv ? "tn" : "K"]
      ];
      for (const [threshold, suffix] of units) {
        if (value >= threshold) {
          const scaled = value / threshold;
          return `${scaled.toFixed(scaled >= 100 ? 0 : 1)} ${suffix}`;
        }
      }
      return value.toLocaleString(NUMBER_LOCALE, { maximumFractionDigits: 0 });
    },
    [isSv]
  );

  const formatAxisTime = useCallback(
    (timestamp: number) => {
      const date = new Date(timestamp);
      if (intraday) {
        return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
      }
      if (range === "5y" || range === "max") {
        return date.toLocaleDateString(locale, { month: "short", year: "2-digit" });
      }
      return date.toLocaleDateString(locale, { day: "numeric", month: "short" });
    },
    [intraday, locale, range]
  );

  const formatFullTime = useCallback(
    (timestamp: number) => {
      const date = new Date(timestamp);
      if (intraday) {
        return date.toLocaleString(locale, {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        });
      }
      return date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
    },
    [intraday, locale]
  );

  // History and the projection share one x scale, so they share one cursor:
  // slots 0…n-1 are candles, and a horizon sits at slot n-1+horizon — exactly
  // where the geometry draws it. Horizons can be sparse (day 1, 5, 10), so the
  // pointer snaps to the nearest modelled day rather than to an empty one.
  const projectionPoints = geometry?.projection?.points ?? [];
  const lastCandleSlot = candles.length - 1;
  const projectionSlots = projectionPoints.map((point) => lastCandleSlot + point.horizon);
  const hoverSlots = [...candles.map((_, index) => index), ...projectionSlots];

  const moveHover = (clientX: number) => {
    if (!geometry || candles.length === 0 || view === "table") {
      return;
    }
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      return;
    }
    const local = clientX - rect.left;
    const slot = Math.floor((local - geometry.plotLeft) / geometry.step);
    if (slot <= lastCandleSlot || projectionSlots.length === 0) {
      setHover(Math.min(lastCandleSlot, Math.max(0, slot)));
      return;
    }
    setHover(
      projectionSlots.reduce((best, candidate) =>
        Math.abs(candidate - slot) < Math.abs(best - slot) ? candidate : best
      )
    );
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => moveHover(event.clientX);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (candles.length === 0) {
      return;
    }
    if (event.key === "Escape") {
      setHover(null);
      return;
    }
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (delta === 0) {
      return;
    }
    event.preventDefault();
    const current = hover ?? lastCandleSlot;
    // A stale slot (the projection went away under the cursor) resumes from the
    // last candle rather than snapping back to the start of the window.
    const found = hoverSlots.indexOf(current);
    const position = found === -1 ? lastCandleSlot : found;
    const next = hoverSlots[Math.min(hoverSlots.length - 1, Math.max(0, position + delta))];
    if (next !== undefined) {
      setHover(next);
    }
  };

  const active = hover !== null && hover <= lastCandleSlot ? candles[hover] ?? null : null;
  // Past the last candle the cursor is on a modelled day, which reads as its own
  // tooltip: there is no open/high/low to quote, only the run's three numbers.
  const activeProjection =
    hover !== null && hover > lastCandleSlot
      ? projectionPoints.find((point) => lastCandleSlot + point.horizon === hover) ?? null
      : null;
  // The readout is a return, not a day-on-day tick: the window is rebased to 100
  // at its first observation (yesterday's close for intraday, which is what an
  // intraday chart is read against) and the hovered point is quoted against that.
  const windowBase = geometry ? (intraday ? geometry.baseline ?? geometry.first : geometry.first) : null;
  const activeRebased =
    active && windowBase !== null && Number.isFinite(windowBase) && windowBase !== 0
      ? (active.close / windowBase) * 100
      : null;
  const activeChange = activeRebased !== null ? activeRebased - 100 : null;

  const headerPrice = meta?.price ?? geometry?.last ?? null;
  const up = (periodChange?.absolute ?? 0) >= 0;
  const periodHigh = candles.length > 0 ? Math.max(...candles.map((c) => c.high ?? c.close)) : null;
  const periodLow = candles.length > 0 ? Math.min(...candles.map((c) => c.low ?? c.close)) : null;
  const rangeLabel = RANGES.find((option) => option.key === range)?.label ?? "";
  const showTable = view === "table" && hasProjection;

  return (
    <section className={`${styles.chart} ${dense ? styles.dense : ""} appSection`}>
      <header className={styles.head}>
        <div className={styles.identity}>
          <p className={styles.eyebrow}>{isSv ? "Kursutveckling" : "Price chart"}</p>
          <h3 className={styles.title}>
            {name ?? meta?.name ?? symbol}
            <span className={styles.symbol}>{meta?.symbol ?? symbol}</span>
          </h3>
          <p className={styles.quote}>
            <strong>{formatPrice(headerPrice)}</strong>
            {meta?.currency ? <span className={styles.currency}>{meta.currency}</span> : null}
            {periodChange ? (
              <span className={up ? styles.up : styles.down}>
                <span aria-hidden="true">{up ? "▲" : "▼"}</span>
                {`${up ? "+" : ""}${formatPrice(periodChange.absolute)} (${up ? "+" : ""}${periodChange.percent.toFixed(2)}%) · ${rangeLabel}`}
              </span>
            ) : null}
          </p>
          <p className={styles.exchange}>
            {[meta?.exchange, candles.length > 0 ? formatFullTime(candles[candles.length - 1].t) : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <div className={styles.rangeTabs} role="tablist" aria-label={isSv ? "Tidsintervall" : "Time range"}>
          {RANGES.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={range === option.key}
              className={`${styles.rangeTab} ${range === option.key ? styles.rangeTabActive : ""}`}
              onClick={() => setRange(option.key)}
              onPointerEnter={() => prefetchHistory(symbol, option.key)}
              onFocus={() => prefetchHistory(symbol, option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <div className={styles.controls}>
        <div className={styles.toggleGroup} role="group" aria-label={isSv ? "Diagramtyp" : "Chart type"}>
          <button
            type="button"
            className={`${styles.toggle} ${chartStyle === "area" ? styles.toggleActive : ""}`}
            onClick={() => setChartStyle("area")}
            aria-pressed={chartStyle === "area"}
          >
            {isSv ? "Linje" : "Line"}
          </button>
          <button
            type="button"
            className={`${styles.toggle} ${chartStyle === "candle" ? styles.toggleActive : ""}`}
            onClick={() => setChartStyle("candle")}
            aria-pressed={chartStyle === "candle"}
          >
            {isSv ? "Candlestick" : "Candles"}
          </button>
        </div>

        <div className={styles.toggleGroup} role="group" aria-label={isSv ? "Indikatorer" : "Indicators"}>
          {OVERLAYS.map((overlay) => {
            const available = candles.length >= overlay.period;
            return (
              <button
                key={overlay.key}
                type="button"
                className={`${styles.toggle} ${overlays[overlay.key] ? styles.toggleActive : ""}`}
                onClick={() => setOverlays((current) => ({ ...current, [overlay.key]: !current[overlay.key] }))}
                aria-pressed={overlays[overlay.key]}
                disabled={!available}
                title={
                  available
                    ? overlay.label
                    : isSv
                      ? `Kräver minst ${overlay.period} datapunkter`
                      : `Needs at least ${overlay.period} data points`
                }
              >
                <span className={styles.swatch} style={{ background: overlay.color } as CSSProperties} aria-hidden="true" />
                {overlay.label}
              </button>
            );
          })}
        </div>

        {/* Only once there is a run to read. The projection and the table are
            the same ten numbers — one as a shape, one as figures — so they are
            a toggle rather than two places to look. */}
        {hasProjection ? (
          <div className={styles.toggleGroup} role="group" aria-label={isSv ? "Projektionsvy" : "Projection view"}>
            <button
              type="button"
              className={`${styles.toggle} ${view === "chart" ? styles.toggleActive : ""}`}
              onClick={() => setView("chart")}
              aria-pressed={view === "chart"}
            >
              <span className={styles.swatchProjection} aria-hidden="true" />
              {isSv ? "Projektion" : "Projection"}
            </button>
            <button
              type="button"
              className={`${styles.toggle} ${view === "table" ? styles.toggleActive : ""}`}
              onClick={() => setView("table")}
              aria-pressed={view === "table"}
            >
              {isSv ? "Avkastningstabell" : "Return table"}
            </button>
          </div>
        ) : null}

        <ChartDownload symbol={meta?.symbol ?? symbol} defaultPreset={DOWNLOAD_PRESETS[range]} className={styles.download} />
      </div>

      {error ? <p className={styles.state}>{error}</p> : null}

      {hasProjection && intraday && !showTable ? (
        <p className={styles.state}>
          {isSv
            ? "Projektionen räknas i handelsdagar — välj 1M eller längre för att se den i diagrammet."
            : "The projection is measured in trading days — pick 1M or longer to see it on the chart."}
        </p>
      ) : null}

      <div
        ref={plotRef}
        className={`${styles.plot} ${loading && !showTable ? styles.plotLoading : ""}`}
        style={showTable ? undefined : { height: `${size.height}px` }}
        onPointerMove={showTable ? undefined : onPointerMove}
        onPointerLeave={showTable ? undefined : () => setHover(null)}
        onKeyDown={showTable ? undefined : onKeyDown}
        tabIndex={showTable ? undefined : 0}
        role={showTable ? undefined : "application"}
        aria-label={
          showTable
            ? undefined
            : isSv
              ? `Kursdiagram för ${meta?.symbol ?? symbol}. Använd vänster och höger piltangent för att läsa av värden.`
              : `Price chart for ${meta?.symbol ?? symbol}. Use the left and right arrow keys to read values.`
        }
      >
        {showTable ? (
          /* The same ten horizons the dashed line draws, as figures. The
             probability and the implied price have no shape on the chart, and
             this is where they are read. */
          <div className={styles.tableWrap}>
            <table className={styles.projectionTable}>
              <caption className={styles.tableCaption}>
                {(isSv ? "Förväntad avkastning per handelsdag, från " : "Expected return per trading day, from ") +
                  formatPrice(geometry?.last ?? null) +
                  (meta?.currency ? ` ${meta.currency}` : "")}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{isSv ? "Dag" : "Day"}</th>
                  <th scope="col">{isSv ? "Förv. avkastning" : "Expected return"}</th>
                  <th scope="col">{isSv ? "Sannolikhet upp" : "Probability up"}</th>
                  <th scope="col">{isSv ? "Implicit kurs" : "Implied price"}</th>
                </tr>
              </thead>
              <tbody>
                {projectionRows.map((row) => {
                  const percent = row.pred_return * 100;
                  return (
                    <tr key={row.horizon}>
                      <th scope="row">{isSv ? `+${row.horizon} d` : `+${row.horizon}d`}</th>
                      <td className={percent >= 0 ? styles.gain : styles.loss}>
                        {`${percent >= 0 ? "+" : "−"}${Math.abs(percent).toFixed(2)}%`}
                      </td>
                      <td>{`${(row.p_up * 100).toFixed(1)}%`}</td>
                      <td>{formatPrice(row.implied_price)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : geometry ? (
          <svg width={geometry.width} height={geometry.height} className={styles.svg}>
            <defs>
              <linearGradient id="stockChartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-price)" stopOpacity="0.26" />
                <stop offset="100%" stopColor="var(--chart-price)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {geometry.priceTicks.map((tick) => (
              <g key={`grid-${tick}`}>
                <line
                  x1={geometry.plotLeft}
                  x2={geometry.plotRight}
                  y1={geometry.y(tick)}
                  y2={geometry.y(tick)}
                  className={styles.grid}
                />
                <text x={geometry.plotRight + 8} y={geometry.y(tick) + 4} className={styles.axisLabel}>
                  {formatPrice(tick, geometry.axisDecimals)}
                </text>
              </g>
            ))}

            {geometry.baseline !== null ? (
              <g>
                <line
                  x1={geometry.plotLeft}
                  x2={geometry.plotRight}
                  y1={geometry.y(geometry.baseline)}
                  y2={geometry.y(geometry.baseline)}
                  className={styles.baseline}
                />
                <text x={geometry.plotLeft + 4} y={geometry.y(geometry.baseline) - 6} className={styles.baselineLabel}>
                  {isSv ? "Föreg. stängning" : "Prev close"}
                </text>
              </g>
            ) : null}

            {/* Volume lives in its own panel so it never shares the price scale. */}
            {candles.map((candle, index) => {
              const width = Math.max(1, geometry.step - 1);
              const top = geometry.volumeY(candle.volume ?? 0);
              const rising = candle.close >= (candle.open ?? candle.close);
              return (
                <rect
                  key={`vol-${candle.t}-${index}`}
                  x={geometry.x(index) - width / 2}
                  y={top}
                  width={width}
                  height={Math.max(0.5, geometry.volumeBottom - top)}
                  className={rising ? styles.volumeUp : styles.volumeDown}
                />
              );
            })}
            <line
              x1={geometry.plotLeft}
              x2={geometry.plotRight}
              y1={geometry.volumeBottom}
              y2={geometry.volumeBottom}
              className={styles.axis}
            />
            <text x={geometry.plotRight + 8} y={geometry.volumeTop + 10} className={styles.axisLabel}>
              {formatVolume(geometry.volumeMax)}
            </text>

            {chartStyle === "area" ? (
              <>
                <path d={geometry.areaPath} fill="url(#stockChartFill)" />
                <path d={geometry.linePath} className={styles.line} />
              </>
            ) : (
              candles.map((candle, index) => {
                const open = candle.open ?? candle.close;
                const high = candle.high ?? candle.close;
                const low = candle.low ?? candle.close;
                const rising = candle.close >= open;
                const width = Math.max(1, geometry.step * 0.66);
                const bodyTop = geometry.y(Math.max(open, candle.close));
                const bodyHeight = Math.max(1, geometry.y(Math.min(open, candle.close)) - bodyTop);
                return (
                  // Rising candles stay hollow and falling ones filled, so direction
                  // survives without color (CVD, print, forced-colors).
                  <g key={`candle-${candle.t}-${index}`} className={rising ? styles.candleUp : styles.candleDown}>
                    <line
                      x1={geometry.x(index)}
                      x2={geometry.x(index)}
                      y1={geometry.y(high)}
                      y2={geometry.y(low)}
                      className={styles.wick}
                    />
                    <rect
                      x={geometry.x(index) - width / 2}
                      y={bodyTop}
                      width={width}
                      height={bodyHeight}
                      className={styles.body}
                    />
                  </g>
                );
              })
            )}

            {geometry.smaPaths.map((overlay) =>
              overlay.ready ? (
                <path
                  key={overlay.key}
                  d={overlay.path}
                  className={styles.smaLine}
                  style={{ stroke: overlay.color } as CSSProperties}
                />
              ) : null
            )}

            {/* The projection, drawn past the last candle in the same plot.
                Dashed and in its own colour throughout: nothing modelled is
                ever allowed to look like a price that happened. */}
            {geometry.projection ? (
              <g>
                <line
                  x1={geometry.projection.splitX}
                  x2={geometry.projection.splitX}
                  y1={geometry.priceTop}
                  y2={geometry.volumeBottom}
                  className={styles.projectionSplit}
                />
                <text
                  x={geometry.projection.splitX + 5}
                  y={geometry.priceTop + 10}
                  className={styles.projectionLabel}
                >
                  {isSv ? "Projektion" : "Projection"}
                </text>
                <line
                  x1={geometry.projection.splitX}
                  x2={geometry.plotRight}
                  y1={geometry.projection.todayY}
                  y2={geometry.projection.todayY}
                  className={styles.projectionToday}
                />
                <path d={geometry.projection.area} className={styles.projectionArea} />
                <path d={geometry.projection.path} className={styles.projectionLine} />
                {/* Ten days inside a six-month window is a narrow strip, so the
                    per-day marks stay small — big enough to say "one point per
                    trading day", small enough not to swallow the line between
                    them. Only the tenth day gets a full dot. */}
                {geometry.projection.points.map((point) => {
                  const isEnd = point.horizon === geometry.projection?.end.horizon;
                  return (
                    <circle
                      key={`proj-${point.horizon}`}
                      cx={point.cx}
                      cy={point.cy}
                      r={isEnd ? 4 : 1.6}
                      className={isEnd ? styles.projectionDot : styles.projectionTick}
                    />
                  );
                })}
                <text
                  x={Math.min(geometry.plotRight - 2, geometry.projection.end.cx)}
                  y={geometry.projection.labelY}
                  textAnchor="end"
                  className={styles.projectionValue}
                >
                  {`${formatPrice(geometry.projection.end.implied_price)} · ${
                    geometry.projection.end.pred_return >= 0 ? "+" : "−"
                  }${Math.abs(geometry.projection.end.pred_return * 100).toFixed(2)}%`}
                </text>
                <text
                  x={Math.min(geometry.plotRight - 2, geometry.projection.end.cx)}
                  y={geometry.height - 6}
                  textAnchor="end"
                  className={styles.projectionAxisLabel}
                >
                  {`+${geometry.projection.end.horizon}${isSv ? " d" : "d"}`}
                </text>
              </g>
            ) : null}

            {geometry.timeTicks.map((index) => (
              <text
                key={`time-${index}`}
                x={Math.min(geometry.plotRight - 26, Math.max(geometry.plotLeft + 26, geometry.x(index)))}
                y={geometry.height - 6}
                className={styles.axisLabel}
                textAnchor="middle"
              >
                {formatAxisTime(candles[index].t)}
              </text>
            ))}

            {active && hover !== null ? (
              <g>
                <line
                  x1={geometry.x(hover)}
                  x2={geometry.x(hover)}
                  y1={geometry.priceTop}
                  y2={geometry.volumeBottom}
                  className={styles.crosshair}
                />
                <line
                  x1={geometry.plotLeft}
                  x2={geometry.plotRight}
                  y1={geometry.y(active.close)}
                  y2={geometry.y(active.close)}
                  className={styles.crosshair}
                />
                <circle cx={geometry.x(hover)} cy={geometry.y(active.close)} r="4.5" className={styles.marker} />
                <rect
                  x={geometry.plotRight + 2}
                  y={geometry.y(active.close) - 11}
                  width={PAD.right - 6}
                  height="22"
                  rx="5"
                  className={styles.readoutBox}
                />
                <text x={geometry.plotRight + 8} y={geometry.y(active.close) + 4} className={styles.readoutText}>
                  {formatPrice(active.close, geometry.priceDecimals)}
                </text>
              </g>
            ) : null}

            {/* The same crosshair past the seam, in the projection's colour so a
                modelled reading is never mistaken for a price that happened. */}
            {activeProjection ? (
              <g>
                <line
                  x1={activeProjection.cx}
                  x2={activeProjection.cx}
                  y1={geometry.priceTop}
                  y2={geometry.volumeBottom}
                  className={styles.crosshair}
                />
                <line
                  x1={geometry.plotLeft}
                  x2={geometry.plotRight}
                  y1={activeProjection.cy}
                  y2={activeProjection.cy}
                  className={styles.crosshair}
                />
                <circle cx={activeProjection.cx} cy={activeProjection.cy} r="4.5" className={styles.projectionDot} />
                <rect
                  x={geometry.plotRight + 2}
                  y={activeProjection.cy - 11}
                  width={PAD.right - 6}
                  height="22"
                  rx="5"
                  className={styles.projectionReadoutBox}
                />
                <text x={geometry.plotRight + 8} y={activeProjection.cy + 4} className={styles.readoutText}>
                  {formatPrice(activeProjection.implied_price, geometry.priceDecimals)}
                </text>
              </g>
            ) : null}
          </svg>
        ) : loading ? (
          <div className={styles.skeleton} aria-hidden="true" />
        ) : (
          <p className={styles.state}>{isSv ? "Ingen kursdata." : "No price data."}</p>
        )}

        {geometry && active && hover !== null && !showTable ? (
          <div
            className={styles.tooltip}
            style={{
              left: `${geometry.x(hover)}px`,
              transform: geometry.x(hover) > geometry.width * 0.58 ? "translate(-100%, 0)" : "translate(0, 0)",
              marginLeft: geometry.x(hover) > geometry.width * 0.58 ? "-12px" : "12px"
            }}
          >
            <p className={styles.tooltipTime}>{formatFullTime(active.t)}</p>
            <dl className={styles.tooltipRows}>
              <div>
                <dt>{isSv ? "Öppning" : "Open"}</dt>
                <dd>{formatPrice(active.open, geometry.priceDecimals)}</dd>
              </div>
              <div>
                <dt>{isSv ? "Högst" : "High"}</dt>
                <dd>{formatPrice(active.high, geometry.priceDecimals)}</dd>
              </div>
              <div>
                <dt>{isSv ? "Lägst" : "Low"}</dt>
                <dd>{formatPrice(active.low, geometry.priceDecimals)}</dd>
              </div>
              <div>
                <dt>{isSv ? "Stängning" : "Close"}</dt>
                <dd>{formatPrice(active.close, geometry.priceDecimals)}</dd>
              </div>
              <div>
                <dt>{isSv ? "Volym" : "Volume"}</dt>
                <dd>{formatVolume(active.volume)}</dd>
              </div>
              {activeChange !== null ? (
                <div>
                  <dt>{isSv ? `Avkastning (${rangeLabel})` : `Return (${rangeLabel})`}</dt>
                  <dd className={activeChange >= 0 ? styles.up : styles.down}>
                    {`${activeChange >= 0 ? "+" : ""}${activeChange.toFixed(2)}%`}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}

        {geometry && activeProjection && !showTable ? (
          <div
            className={`${styles.tooltip} ${styles.tooltipProjection}`}
            style={{
              left: `${activeProjection.cx}px`,
              transform: activeProjection.cx > geometry.width * 0.58 ? "translate(-100%, 0)" : "translate(0, 0)",
              marginLeft: activeProjection.cx > geometry.width * 0.58 ? "-12px" : "12px"
            }}
          >
            <p className={styles.tooltipTime}>
              {isSv
                ? `Projektion · +${activeProjection.horizon} handelsdagar`
                : `Projection · +${activeProjection.horizon} trading days`}
            </p>
            <dl className={styles.tooltipRows}>
              <div>
                <dt>{isSv ? "Implicit kurs" : "Implied price"}</dt>
                <dd>{formatPrice(activeProjection.implied_price, geometry.priceDecimals)}</dd>
              </div>
              <div>
                <dt>{isSv ? "Förv. avkastning" : "Expected return"}</dt>
                <dd className={activeProjection.pred_return >= 0 ? styles.gain : styles.loss}>
                  {`${activeProjection.pred_return >= 0 ? "+" : "−"}${Math.abs(activeProjection.pred_return * 100).toFixed(2)}%`}
                </dd>
              </div>
              <div>
                <dt>{isSv ? "Sannolikhet upp" : "Probability up"}</dt>
                <dd>{`${(activeProjection.p_up * 100).toFixed(1)}%`}</dd>
              </div>
            </dl>
            <p className={styles.tooltipModelled}>{isSv ? "Modellberäknat" : "Model-computed"}</p>
          </div>
        ) : null}
      </div>

      {/* The legend names marks in the plot, so it goes with the plot: reading
          the table there is nothing to key. */}
      <div className={styles.legend} hidden={showTable}>
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: "var(--chart-price)" } as CSSProperties} aria-hidden="true" />
          {isSv ? "Kurs" : "Price"}
        </span>
        {(geometry?.smaPaths ?? [])
          .filter((overlay) => overlay.ready)
          .map((overlay) => (
            <span key={overlay.key} className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: overlay.color } as CSSProperties} aria-hidden="true" />
              {overlay.label}
            </span>
          ))}
        <span className={styles.legendItem}>
          <span className={styles.swatchVolume} aria-hidden="true" />
          {isSv ? "Volym" : "Volume"}
        </span>
        {geometry?.projection ? (
          <span className={styles.legendItem}>
            <span className={styles.swatchProjection} aria-hidden="true" />
            {isSv
              ? `Projektion (${geometry.projection.end.horizon} d)`
              : `Projection (${geometry.projection.end.horizon}d)`}
          </span>
        ) : null}
      </div>

      {/* Travels with the drawing, not with the tab that started the run: the
          projection is readable here on its own, so the line that says it is an
          illustration has to be here too (ROADMAP §7.2). */}
      {hasProjection ? (
        <p className={styles.projectionNote}>
          {isSv
            ? "Modellberäknad illustration av möjliga utfall, inte en prognos och inte investeringsrådgivning."
            : "A model-computed illustration of possible outcomes — not a forecast, and not investment advice."}
        </p>
      ) : null}

      <dl className={styles.stats}>
        <div>
          <dt>{isSv ? "Föreg. stängning" : "Prev close"}</dt>
          <dd>{formatPrice(meta?.previousClose)}</dd>
        </div>
        <div>
          <dt>{isSv ? "Dagens högsta" : "Day high"}</dt>
          <dd>{formatPrice(meta?.dayHigh)}</dd>
        </div>
        <div>
          <dt>{isSv ? "Dagens lägsta" : "Day low"}</dt>
          <dd>{formatPrice(meta?.dayLow)}</dd>
        </div>
        <div>
          <dt>{isSv ? `Högsta (${rangeLabel})` : `High (${rangeLabel})`}</dt>
          <dd>{formatPrice(periodHigh)}</dd>
        </div>
        <div>
          <dt>{isSv ? `Lägsta (${rangeLabel})` : `Low (${rangeLabel})`}</dt>
          <dd>{formatPrice(periodLow)}</dd>
        </div>
        <div>
          <dt>{isSv ? "52v högsta" : "52w high"}</dt>
          <dd>{formatPrice(meta?.fiftyTwoWeekHigh)}</dd>
        </div>
        <div>
          <dt>{isSv ? "52v lägsta" : "52w low"}</dt>
          <dd>{formatPrice(meta?.fiftyTwoWeekLow)}</dd>
        </div>
        <div>
          <dt>{isSv ? "Volym" : "Volume"}</dt>
          <dd>{formatVolume(meta?.volume ?? candles[candles.length - 1]?.volume ?? null)}</dd>
        </div>
      </dl>
    </section>
  );
}
