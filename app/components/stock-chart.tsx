"use client";

import {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useLanguage } from "@/app/i18n/language";
import ChartDownload, { type DownloadPreset } from "./chart-download";
import styles from "./stock-chart.module.css";

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

export default function StockChart({ symbol, name }: { symbol: string; name?: string | null }) {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const locale = isSv ? "sv-SE" : "en-US";

  const [range, setRange] = useState<RangeKey>("6mo");
  const [chartStyle, setChartStyle] = useState<"area" | "candle">("area");
  const [overlays, setOverlays] = useState<Record<"sma50" | "sma200", boolean>>({ sma50: false, sma200: false });
  const [payload, setPayload] = useState<HistoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [size, setSize] = useState({ width: 960, height: 360 });
  const plotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = plotRef.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);
      if (width > 0) {
        setSize({ width, height: width < 560 ? 260 : width < 820 ? 320 : 380 });
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setHover(null);

    const load = async () => {
      try {
        const response = await fetch(`/api/tickers/history?symbol=${encodeURIComponent(symbol)}&range=${range}`, {
          signal: controller.signal,
          cache: "no-store"
        });
        const json = (await response.json()) as HistoryPayload;
        if (!response.ok || !json.ok || !Array.isArray(json.candles) || json.candles.length === 0) {
          throw new Error(json.error ?? (isSv ? "Kursdata saknas" : "Price history unavailable"));
        }
        setPayload(json);
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return;
        }
        setPayload(null);
        setError(err instanceof Error ? err.message : isSv ? "Okänt fel" : "Unknown error");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => controller.abort();
  }, [isSv, range, symbol]);

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

    const lows = chartStyle === "candle" ? candles.map((c) => c.low ?? c.close) : closes;
    const highs = chartStyle === "candle" ? candles.map((c) => c.high ?? c.close) : closes;
    const overlaySeries = OVERLAYS.filter((overlay) => overlays[overlay.key]).map((overlay) => ({
      ...overlay,
      values: sma(closes, overlay.period)
    }));
    const overlayValues = overlaySeries
      .flatMap((overlay) => overlay.values)
      .filter((value): value is number => value !== null);

    let min = Math.min(...lows, ...overlayValues, ...(baseline !== null ? [baseline] : []));
    let max = Math.max(...highs, ...overlayValues, ...(baseline !== null ? [baseline] : []));
    if (max === min) {
      min -= Math.abs(min) * 0.01 || 1;
      max += Math.abs(max) * 0.01 || 1;
    }
    const headroom = (max - min) * 0.06;
    min -= headroom;
    max += headroom;

    const step = (plotRight - plotLeft) / candles.length;
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
      first: closes[0],
      last: closes[closes.length - 1]
    };
  }, [candles, chartStyle, intraday, meta, overlays, size]);

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
      return value.toLocaleString(locale, { minimumFractionDigits: fraction, maximumFractionDigits: fraction });
    },
    [geometry, locale]
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
      return value.toLocaleString(locale, { maximumFractionDigits: 0 });
    },
    [isSv, locale]
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

  const moveHover = (clientX: number) => {
    if (!geometry || candles.length === 0) {
      return;
    }
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      return;
    }
    const local = clientX - rect.left;
    const index = Math.min(candles.length - 1, Math.max(0, Math.floor((local - geometry.plotLeft) / geometry.step)));
    setHover(index);
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
    const current = hover ?? candles.length - 1;
    setHover(Math.min(candles.length - 1, Math.max(0, current + delta)));
  };

  const active = hover !== null ? candles[hover] ?? null : null;
  const activeReference =
    active && hover !== null
      ? intraday
        ? meta?.previousClose ?? (hover > 0 ? candles[hover - 1].close : null)
        : hover > 0
          ? candles[hover - 1].close
          : null
      : null;
  const activeChange =
    active && activeReference !== null && activeReference !== 0
      ? ((active.close - activeReference) / activeReference) * 100
      : null;

  const headerPrice = meta?.price ?? geometry?.last ?? null;
  const up = (periodChange?.absolute ?? 0) >= 0;
  const periodHigh = candles.length > 0 ? Math.max(...candles.map((c) => c.high ?? c.close)) : null;
  const periodLow = candles.length > 0 ? Math.min(...candles.map((c) => c.low ?? c.close)) : null;
  const rangeLabel = RANGES.find((option) => option.key === range)?.label ?? "";

  return (
    <section className={`${styles.chart} appSection`}>
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

        <ChartDownload symbol={meta?.symbol ?? symbol} defaultPreset={DOWNLOAD_PRESETS[range]} className={styles.download} />
      </div>

      {error ? <p className={styles.state}>{error}</p> : null}

      <div
        ref={plotRef}
        className={`${styles.plot} ${loading ? styles.plotLoading : ""}`}
        style={{ height: `${size.height}px` }}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="application"
        aria-label={
          isSv
            ? `Kursdiagram för ${meta?.symbol ?? symbol}. Använd vänster och höger piltangent för att läsa av värden.`
            : `Price chart for ${meta?.symbol ?? symbol}. Use the left and right arrow keys to read values.`
        }
      >
        {geometry ? (
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
          </svg>
        ) : loading ? (
          <div className={styles.skeleton} aria-hidden="true" />
        ) : (
          <p className={styles.state}>{isSv ? "Ingen kursdata." : "No price data."}</p>
        )}

        {geometry && active && hover !== null ? (
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
                  <dt>{isSv ? "Förändring" : "Change"}</dt>
                  <dd className={activeChange >= 0 ? styles.up : styles.down}>
                    {`${activeChange >= 0 ? "+" : ""}${activeChange.toFixed(2)}%`}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}
      </div>

      <div className={styles.legend}>
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
      </div>

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
