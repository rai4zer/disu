"use client";

/**
 * The headline card: total value, the year's move, and the shape that got there.
 *
 * Three deliberate choices, all of them about not overclaiming:
 *
 * **The period is named, not assumed.** The reference design this follows says
 * "Utv. i år" — this year — over a broker that has held the account for years.
 * DISU's history begins the day the daily snapshot sweep first valued the
 * portfolio (migration 0021), which for every current user is far more recent
 * than 1 January. So the figure is computed from the first snapshot *in the
 * current calendar year* and the label states the date it actually measures
 * from. Printing "this year" over eleven days of history would be a lie with a
 * percent sign on it.
 *
 * **Gaps stay gaps.** The line is drawn as segments and breaks across a stretch
 * with no snapshots, for the same reason `portfolio-chart.tsx` does it: a day
 * with no row is a day nothing could be observed, and bridging it draws a
 * measurement that was never taken (docs/synthetic-data-policy.md).
 *
 * **No axis, no gridlines, no labels.** This is a sparkline — it carries the
 * shape of the year, and the two numbers above it carry the quantities. The
 * full chart with its ranges and tooltips is still on the page below.
 */

import { useMemo } from "react";
import type { PortfolioHistoryPoint } from "@/app/components/portfolio-chart";
import { useLanguage } from "@/app/i18n/language";
import styles from "./page.module.css";

const DAY_MS = 86_400_000;
/** Matches the full chart: a longer hole than this is not drawn across. */
const MAX_JOINABLE_GAP_DAYS = 5;

const VIEW_W = 560;
const VIEW_H = 150;

type YearMove =
  | { available: false }
  | { available: true; pct: number; amount: number; since: string };

/**
 * The move across the snapshots that fall in the current calendar year.
 *
 * Returns the date it measured from so the caller can say so. When only one
 * snapshot exists this year there is no move to report — one observation is a
 * value, not a change.
 */
function yearMove(points: PortfolioHistoryPoint[]): YearMove {
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const inYear = points.filter((point) => point.date >= yearStart);
  if (inYear.length < 2) {
    return { available: false };
  }

  const first = inYear[0];
  const last = inYear[inYear.length - 1];
  if (!Number.isFinite(first.value) || first.value <= 0) {
    return { available: false };
  }

  return {
    available: true,
    amount: last.value - first.value,
    pct: ((last.value - first.value) / first.value) * 100,
    since: first.date
  };
}

export default function ValueCard({
  points,
  totalValue,
  currency,
  loading
}: {
  points: PortfolioHistoryPoint[];
  totalValue: number | null;
  currency: string;
  loading: boolean;
}) {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const locale = isSv ? "sv-SE" : "en-US";

  const money = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }),
    [locale, currency]
  );

  const move = useMemo(() => yearMove(points), [points]);

  /** The sparkline, as segments so a gap can stay a gap. */
  const paths = useMemo(() => {
    const usable = points.filter((point) => Number.isFinite(point.value));
    if (usable.length < 2) {
      return null;
    }

    const coords = usable.map((point) => ({
      time: Date.parse(`${point.date}T00:00:00Z`),
      value: point.value
    }));

    const times = coords.map((c) => c.time);
    const values = coords.map((c) => c.value);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);

    // A flat series would divide by zero; draw it down the middle instead.
    const spanTime = maxTime - minTime || 1;
    const spanValue = maxValue - minValue || 1;
    const pad = 6;

    const x = (time: number) => ((time - minTime) / spanTime) * VIEW_W;
    const y = (value: number) =>
      VIEW_H - pad - ((value - minValue) / spanValue) * (VIEW_H - pad * 2);

    const segments: Array<Array<{ x: number; y: number }>> = [];
    let current: Array<{ x: number; y: number }> = [];
    coords.forEach((coord, index) => {
      if (index > 0 && coord.time - coords[index - 1].time > MAX_JOINABLE_GAP_DAYS * DAY_MS) {
        segments.push(current);
        current = [];
      }
      current.push({ x: x(coord.time), y: y(coord.value) });
    });
    segments.push(current);

    const drawn = segments.filter((segment) => segment.length >= 2);
    if (drawn.length === 0) {
      return null;
    }

    return {
      lines: drawn.map((segment) => segment.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")),
      // The fill is per segment too, so a gap does not get shaded across.
      areas: drawn.map((segment) => {
        const line = segment.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
        const first = segment[0];
        const last = segment[segment.length - 1];
        return `${line} L${last.x.toFixed(1)} ${VIEW_H} L${first.x.toFixed(1)} ${VIEW_H} Z`;
      })
    };
  }, [points]);

  const direction = move.available ? (move.pct > 0 ? "up" : move.pct < 0 ? "down" : "flat") : "flat";

  const sinceLabel = move.available
    ? new Date(`${move.since}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short" })
    : null;

  return (
    <article className={`dsCard ${styles.valueCard} ${styles[`trend_${direction}`]}`}>
      <div className={styles.valueHead}>
        <div className={styles.valueBlock}>
          <h2 className="dsCardTitle">{isSv ? "Totalt värde" : "Total value"}</h2>
          <p className={styles.valueFigure}>
            {totalValue === null ? "—" : money.format(totalValue)}
          </p>
        </div>

        <div className={`${styles.valueBlock} ${styles.valueBlockSplit}`}>
          <h2 className="dsCardTitle">{isSv ? "Utv. i år" : "Return this year"}</h2>
          {move.available ? (
            <>
              <p className={`${styles.valueDelta} ${styles[direction]}`}>
                {move.pct > 0 ? "+" : move.pct < 0 ? "−" : ""}
                {Math.abs(move.pct).toFixed(2)}%
              </p>
              {/*
                The period is stated because it is not the whole year. History
                starts when the snapshot sweep does, and saying "this year" over
                a shorter window would overstate what was measured.
              */}
              <p className={styles.valueSince}>
                {isSv ? "sedan" : "since"} {sinceLabel} · {move.amount > 0 ? "+" : move.amount < 0 ? "−" : ""}
                {money.format(Math.abs(move.amount))}
              </p>
            </>
          ) : (
            <>
              <p className={styles.valueUnavailable}>—</p>
              <p className={styles.valueSince}>
                {isSv
                  ? "Behöver minst två dagars historik i år."
                  : "Needs at least two days of history this year."}
              </p>
            </>
          )}
        </div>
      </div>

      <div className={styles.spark}>
        {loading ? null : paths === null ? (
          <p className={styles.sparkEmpty}>
            {isSv
              ? "Kurvan ritas när vi har flera dagars historik."
              : "The curve appears once we have a few days of history."}
          </p>
        ) : (
          <svg
            className={styles.sparkSvg}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            {paths.areas.map((area, index) => (
              <path key={`area-${index}`} d={area} fill="url(#sparkFill)" />
            ))}
            {paths.lines.map((line, index) => (
              <path
                key={`line-${index}`}
                d={line}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        )}
      </div>
    </article>
  );
}
