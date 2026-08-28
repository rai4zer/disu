"use client";

import {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useLanguage } from "@/app/i18n/language";
import styles from "./portfolio-chart.module.css";

export type PortfolioHistoryPoint = {
  date: string;
  value: number;
};

export type RangeKey = "1m" | "3m" | "1y" | "max";

const RANGES: Array<{ key: RangeKey; days: number | null; label: string }> = [
  { key: "1m", days: 30, label: "1M" },
  { key: "3m", days: 90, label: "3M" },
  { key: "1y", days: 365, label: "1Y" },
  { key: "max", days: null, label: "MAX" }
];

// Drawn in real CSS pixels rather than a stretched viewBox, so the axis text is
// never squashed and the line keeps its 2px weight at any card width.
const PAD = { top: 14, right: 58, bottom: 20, left: 6 };
const HEIGHT = 216;

/**
 * How long a hole in the series has to be before the line is cut rather than
 * drawn across.
 *
 * A daily series naturally skips weekends and holidays, so a short hole is the
 * market being closed and joining across it is honest. A longer one means the
 * portfolio could not be observed — no quote, an outage, an instance that never
 * ran the sweep — and a straight segment through it would invent a smooth path
 * that nobody recorded (docs/synthetic-data-policy.md).
 */
const MAX_JOINABLE_GAP_DAYS = 5;
const DAY_MS = 86_400_000;

function niceTicks(min: number, max: number, count: number): number[] {
  if (!(max > min)) {
    return [min];
  }
  const rawStep = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;
  const step = (normalised >= 5 ? 10 : normalised >= 2 ? 5 : normalised >= 1 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max + step * 0.001; tick += step) {
    ticks.push(Math.round(tick * 1e6) / 1e6);
  }
  return ticks;
}

export default function PortfolioChart({
  points,
  currency,
  loading = false
}: {
  points: PortfolioHistoryPoint[];
  currency: string;
  loading?: boolean;
}) {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const locale = isSv ? "sv-SE" : "en-US";

  const [range, setRange] = useState<RangeKey>("max");
  const [cursor, setCursor] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [width, setWidth] = useState(720);
  const plotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = plotRef.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured && measured > 0) {
        setWidth(measured);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const money = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 0
      }),
    [locale, currency]
  );

  const axisMoney = useMemo(
    () => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }),
    [locale]
  );

  const percentFormat = useMemo(
    () => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [locale]
  );

  const dayLabel = useCallback(
    (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short" }),
    [locale]
  );

  /** Points inside the selected window, oldest first. */
  const series = useMemo(() => {
    if (points.length === 0) {
      return [];
    }
    const days = RANGES.find((entry) => entry.key === range)?.days ?? null;
    if (days === null) {
      return points;
    }
    const newest = Date.parse(`${points[points.length - 1].date}T00:00:00Z`);
    const cutoff = newest - days * DAY_MS;
    return points.filter((point) => Date.parse(`${point.date}T00:00:00Z`) >= cutoff);
  }, [points, range]);

  // A preset that would show a single dot is offered as disabled rather than
  // hidden, so the control row does not reshuffle as history accumulates.
  const rangeAvailability = useMemo(() => {
    const newest = points.length === 0 ? null : Date.parse(`${points[points.length - 1].date}T00:00:00Z`);
    return new Map(
      RANGES.map((entry) => {
        if (newest === null) return [entry.key, false] as const;
        if (entry.days === null) return [entry.key, points.length >= 2] as const;
        const cutoff = newest - entry.days * DAY_MS;
        const inWindow = points.filter((point) => Date.parse(`${point.date}T00:00:00Z`) >= cutoff).length;
        return [entry.key, inWindow >= 2] as const;
      })
    );
  }, [points]);

  const geometry = useMemo(() => {
    if (series.length === 0) {
      return null;
    }

    const times = series.map((point) => Date.parse(`${point.date}T00:00:00Z`));
    const values = series.map((point) => point.value);
    const minTime = times[0];
    const maxTime = times[times.length - 1];
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    // A portfolio that moved 1% over the window should look like it moved 1%,
    // not like a flat line — so the band is padded around the data rather than
    // anchored at zero, and the axis labels state the actual level.
    const span = rawMax - rawMin;
    const padding = span === 0 ? Math.max(Math.abs(rawMax) * 0.02, 1) : span * 0.12;
    const minValue = rawMin - padding;
    const maxValue = rawMax + padding;

    const plotWidth = Math.max(80, width - PAD.left - PAD.right);
    const plotHeight = HEIGHT - PAD.top - PAD.bottom;

    const x = (time: number) =>
      maxTime === minTime
        ? PAD.left + plotWidth / 2
        : PAD.left + ((time - minTime) / (maxTime - minTime)) * plotWidth;
    const y = (value: number) => PAD.top + (1 - (value - minValue) / (maxValue - minValue)) * plotHeight;

    const coords = series.map((point, index) => ({ x: x(times[index]), y: y(point.value), point, time: times[index] }));

    // Segments, not one path: a hole longer than a market weekend breaks the
    // line instead of being drawn through.
    const segments: Array<typeof coords> = [];
    let current: typeof coords = [];
    for (let index = 0; index < coords.length; index += 1) {
      if (index > 0 && coords[index].time - coords[index - 1].time > MAX_JOINABLE_GAP_DAYS * DAY_MS) {
        segments.push(current);
        current = [];
      }
      current.push(coords[index]);
    }
    segments.push(current);

    const linePaths = segments
      .filter((segment) => segment.length > 0)
      .map((segment) =>
        segment.map((coord, index) => `${index === 0 ? "M" : "L"}${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`).join(" ")
      );

    const baseline = PAD.top + plotHeight;
    const areaPaths = segments
      .filter((segment) => segment.length > 1)
      .map(
        (segment) =>
          `M${segment[0].x.toFixed(2)} ${baseline.toFixed(2)} ` +
          segment.map((coord) => `L${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`).join(" ") +
          ` L${segment[segment.length - 1].x.toFixed(2)} ${baseline.toFixed(2)} Z`
      );

    return {
      coords,
      linePaths,
      areaPaths,
      baseline,
      plotWidth,
      plotHeight,
      ticks: niceTicks(minValue, maxValue, 3).map((value) => ({ value, y: y(value) })),
      first: series[0],
      last: series[series.length - 1],
      gaps: segments.filter((segment) => segment.length > 0).length - 1
    };
  }, [series, width]);

  const change = useMemo(() => {
    if (!geometry) return null;
    const from = geometry.first.value;
    const to = geometry.last.value;
    return { amount: to - from, pct: from > 0 ? ((to - from) / from) * 100 : null };
  }, [geometry]);

  const direction = change === null || change.amount === 0 ? "flat" : change.amount > 0 ? "up" : "down";

  useEffect(() => {
    setCursor(null);
  }, [range, points]);

  const nearestIndex = useCallback(
    (clientX: number) => {
      const node = plotRef.current;
      if (!node || !geometry) return null;
      const rect = node.getBoundingClientRect();
      const localX = clientX - rect.left;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      geometry.coords.forEach((coord, index) => {
        const distance = Math.abs(coord.x - localX);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      return best;
    },
    [geometry]
  );

  const handlePointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const index = nearestIndex(event.clientX);
      if (index !== null) setCursor(index);
    },
    [nearestIndex]
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!geometry) return;
      const last = geometry.coords.length - 1;
      const at = cursor ?? last;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setCursor(Math.max(0, at - 1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setCursor(Math.min(last, at + 1));
      } else if (event.key === "Home") {
        event.preventDefault();
        setCursor(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setCursor(last);
      } else if (event.key === "Escape") {
        setCursor(null);
      }
    },
    [cursor, geometry]
  );

  const active = geometry && cursor !== null ? geometry.coords[cursor] ?? null : null;

  const signed = (value: number, formatter: (input: number) => string) =>
    `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatter(Math.abs(value))}`;

  return (
    <section className={`${styles.card} appSection`} aria-label={isSv ? "Portföljutveckling" : "Portfolio performance"}>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>{isSv ? "Utveckling" : "Performance"}</h2>
          {change === null ? null : (
            <p className={`${styles.delta} ${styles[`delta_${direction}`]}`}>
              {signed(change.amount, (value) => money.format(value))}
              {change.pct === null ? null : (
                <span> {signed(change.pct, (value) => `${percentFormat.format(value)}%`)}</span>
              )}
            </p>
          )}
        </div>
        <div className={styles.ranges} role="group" aria-label={isSv ? "Tidsintervall" : "Time range"}>
          {RANGES.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={entry.key === range ? `${styles.range} ${styles.rangeOn}` : styles.range}
              aria-pressed={entry.key === range}
              disabled={!rangeAvailability.get(entry.key)}
              onClick={() => setRange(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </header>

      {geometry === null ? (
        <p className={styles.note}>
          {loading
            ? isSv
              ? "Läser in historik…"
              : "Loading history…"
            : points.length === 1
              ? isSv
                ? "Vi har en dagsnotering. Grafen ritas när det finns en dag att jämföra med."
                : "We have one day recorded. The chart draws once there is a second day to compare with."
              : isSv
                ? "Historiken börjar den dag du lade till ditt första innehav. Inget är uppfunnet i efterhand, så grafen kommer när dagarna finns."
                : "History starts the day you added your first holding. Nothing is backfilled, so the chart follows once the days exist."}
        </p>
      ) : (
        <>
          <div
            ref={plotRef}
            className={styles.plot}
            style={{ height: HEIGHT }}
            tabIndex={0}
            role="img"
            aria-label={
              isSv
                ? `Portföljvärde ${dayLabel(geometry.first.date)} till ${dayLabel(geometry.last.date)}: ${money.format(geometry.first.value)} till ${money.format(geometry.last.value)}. Använd vänster och höger piltangent för att läsa av dagar.`
                : `Portfolio value ${dayLabel(geometry.first.date)} to ${dayLabel(geometry.last.date)}: ${money.format(geometry.first.value)} to ${money.format(geometry.last.value)}. Use the left and right arrow keys to read individual days.`
            }
            onPointerMove={handlePointer}
            onPointerLeave={() => setCursor(null)}
            onKeyDown={handleKeyDown}
            onBlur={() => setCursor(null)}
          >
            <svg width={width} height={HEIGHT} className={`${styles.svg} ${styles[`svg_${direction}`]}`} aria-hidden="true">
              {geometry.ticks.map((tick) => (
                <g key={tick.value}>
                  <line className={styles.grid} x1={PAD.left} x2={width - PAD.right} y1={tick.y} y2={tick.y} />
                  <text className={styles.axis} x={width - PAD.right + 8} y={tick.y + 3.5}>
                    {axisMoney.format(tick.value)}
                  </text>
                </g>
              ))}

              {geometry.areaPaths.map((path) => (
                <path key={path.slice(0, 24)} className={styles.area} d={path} />
              ))}
              {geometry.linePaths.map((path) => (
                <path key={path.slice(0, 24)} className={styles.line} d={path} />
              ))}

              {active ? (
                <>
                  <line className={styles.crosshair} x1={active.x} x2={active.x} y1={PAD.top} y2={geometry.baseline} />
                  <circle className={styles.marker} cx={active.x} cy={active.y} r={4.5} />
                </>
              ) : (
                <circle
                  className={styles.marker}
                  cx={geometry.coords[geometry.coords.length - 1].x}
                  cy={geometry.coords[geometry.coords.length - 1].y}
                  r={4.5}
                />
              )}

              <text className={styles.axisEdge} x={PAD.left} y={HEIGHT - 6}>
                {dayLabel(geometry.first.date)}
              </text>
              <text className={styles.axisEdge} x={width - PAD.right} y={HEIGHT - 6} textAnchor="end">
                {dayLabel(geometry.last.date)}
              </text>
            </svg>

            {active ? (
              <div
                className={styles.tooltip}
                style={{
                  left: Math.min(Math.max(active.x, 64), Math.max(width - PAD.right - 8, 64)),
                  top: PAD.top
                }}
                role="status"
              >
                <strong>{money.format(active.point.value)}</strong>
                <span>{dayLabel(active.point.date)}</span>
              </div>
            ) : null}
          </div>

          <p className={styles.readout}>
            {isSv ? "Senast" : "Latest"} <strong>{money.format(geometry.last.value)}</strong>{" "}
            <span>
              {dayLabel(geometry.last.date)} · {series.length} {isSv ? "dagar" : "days"}
            </span>
          </p>

          {geometry.gaps > 0 ? (
            <p className={styles.note}>
              {isSv
                ? `Linjen är bruten på ${geometry.gaps} ställe(n) där portföljen inte kunde värderas. Vi drar ingen linje genom dagar vi inte har sett.`
                : `The line is broken in ${geometry.gaps} place(s) where the portfolio could not be valued. We do not draw a line through days we did not observe.`}
            </p>
          ) : null}

          <button type="button" className={styles.tableToggle} onClick={() => setShowTable((open) => !open)}>
            {showTable ? (isSv ? "Dölj tabell" : "Hide table") : isSv ? "Visa som tabell" : "Show as table"}
          </button>

          {showTable ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <caption className={styles.tableCaption}>
                  {isSv ? "Portföljvärde per dag" : "Portfolio value by day"} ({currency})
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{isSv ? "Datum" : "Date"}</th>
                    <th scope="col">{isSv ? "Värde" : "Value"}</th>
                  </tr>
                </thead>
                <tbody>
                  {series
                    .slice()
                    .reverse()
                    .map((point) => (
                      <tr key={point.date}>
                        <th scope="row">{point.date}</th>
                        <td>{money.format(point.value)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
