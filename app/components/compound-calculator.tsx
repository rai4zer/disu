"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import styles from "./compound-calculator.module.css";
import { NUMBER_LOCALE } from "@/app/lib/format/number";

type CalculatorCopy = {
  title: string;
  body: string;
  startCapital: string;
  monthlyDeposit: string;
  rate: string;
  years: string;
  yearsUnit: string;
  withCompounding: string;
  withoutCompounding: string;
  growth: string;
  today: string;
  afterYears: string;
  valueToday: string;
  valueAfterYears: string;
  chartSummary: string;
};

type Point = {
  year: number;
  compounded: number;
  flat: number;
};

const START = { min: 0, max: 1_000_000, step: 5_000 };
const MONTHLY = { min: 0, max: 50_000, step: 500 };
const RATE = { min: 0, max: 15, step: 0.5 };
const YEARS = { min: 1, max: 40, step: 1 };

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

/** Monthly compounding, deposits added at the end of each month. */
function buildSeries(start: number, monthly: number, ratePct: number, years: number): Point[] {
  const monthlyRate = ratePct / 100 / 12;
  const points: Point[] = [{ year: 0, compounded: start, flat: start }];
  let balance = start;

  for (let year = 1; year <= years; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      balance = balance * (1 + monthlyRate) + monthly;
    }
    points.push({ year, compounded: balance, flat: start + monthly * 12 * year });
  }

  return points;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    style: "currency",
    currency: "SEK",
    maximumFractionDigits: 0
  }).format(Math.round(value));
}

type SliderRowProps = {
  label: string;
  unit: string;
  value: number;
  valueText: string;
  bounds: { min: number; max: number; step: number };
  /** Money fields get grouped digits ("100,000"); plain fields keep a number input. */
  money?: boolean;
  onChange: (next: number) => void;
};

function SliderRow({ label, unit, value, valueText, bounds, money, onChange }: SliderRowProps) {
  const { min, max, step } = bounds;
  const fill = max === min ? 0 : ((value - min) / (max - min)) * 100;

  return (
    <label className={styles.control}>
      <span className={styles.controlHead}>
        <span className={styles.controlLabel}>{label}</span>
        <span className={styles.controlValue}>
          {money ? (
            <input
              type="text"
              inputMode="numeric"
              className={`${styles.numberInput} ${styles.numberInputWide}`}
              value={new Intl.NumberFormat(NUMBER_LOCALE).format(value)}
              aria-label={label}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, "");
                onChange(clamp(digits === "" ? min : Number(digits), min, max));
              }}
            />
          ) : (
            <input
              type="number"
              className={styles.numberInput}
              value={value}
              min={min}
              max={max}
              step={step}
              aria-label={label}
              onChange={(event) => onChange(clamp(Number(event.target.value), min, max))}
            />
          )}
          <span className={styles.unit}>{unit}</span>
        </span>
      </span>
      <input
        type="range"
        className={styles.slider}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        value={value}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        aria-valuetext={valueText}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export default function CompoundCalculator({ copy }: { copy: CalculatorCopy }) {
  const [start, setStart] = useState(100_000);
  const [monthly, setMonthly] = useState(2_000);
  const [rate, setRate] = useState(8);
  const [years, setYears] = useState(30);
  const [hoverYear, setHoverYear] = useState<number | null>(null);

  const series = useMemo(
    () => buildSeries(start, monthly, rate, years),
    [start, monthly, rate, years]
  );
  const peak = series[series.length - 1];
  const active = (hoverYear === null ? null : series.find((point) => point.year === hoverYear)) ?? peak;
  const growth = active.compounded - active.flat;
  const activeCaption =
    active.year === 0
      ? copy.valueToday
      : copy.valueAfterYears.replace("{years}", String(active.year));

  return (
    <div className={styles.card}>
      <div className={styles.intro}>
        <h2 className={styles.title}>{copy.title}</h2>
        <p className={styles.body}>{copy.body}</p>
      </div>

      <div className={styles.controls}>
        <SliderRow
          label={copy.startCapital}
          unit="kr"
          value={start}
          valueText={formatMoney(start)}
          bounds={START}
          money
          onChange={setStart}
        />
        <SliderRow
          label={copy.monthlyDeposit}
          unit="kr"
          value={monthly}
          valueText={formatMoney(monthly)}
          bounds={MONTHLY}
          money
          onChange={setMonthly}
        />
        <SliderRow
          label={copy.rate}
          unit="%"
          value={rate}
          valueText={`${rate} %`}
          bounds={RATE}
          onChange={setRate}
        />
        <SliderRow
          label={copy.years}
          unit={copy.yearsUnit}
          value={years}
          valueText={`${years} ${copy.yearsUnit}`}
          bounds={YEARS}
          onChange={setYears}
        />
      </div>

      <div className={styles.results} aria-live="polite">
        <div className={styles.result}>
          <span className={`${styles.legend} ${styles.legendCompound}`}>{copy.withCompounding}</span>
          <strong className={styles.resultValue}>{formatMoney(active.compounded)}</strong>
        </div>
        <div className={styles.result}>
          <span className={`${styles.legend} ${styles.legendFlat}`}>{copy.withoutCompounding}</span>
          <strong className={`${styles.resultValue} ${styles.resultValueMuted}`}>
            {formatMoney(active.flat)}
          </strong>
        </div>
        <div className={styles.result}>
          <span className={styles.legend}>{copy.growth}</span>
          <strong className={`${styles.resultValue} ${styles.resultValueGrowth}`}>
            +{formatMoney(growth)}
          </strong>
        </div>
        <p className={styles.caption}>{activeCaption}</p>
      </div>

      {/* Hover is released on the wrapper, not the plot area: a couple of pixels of reflow
          must not count as leaving the chart. */}
      <div className={styles.chartWrap} onMouseLeave={() => setHoverYear(null)}>
        <div
          className={styles.chart}
          role="img"
          aria-label={copy.chartSummary
            .replace("{years}", String(years))
            .replace("{compounded}", formatMoney(peak.compounded))
            .replace("{flat}", formatMoney(peak.flat))}
        >
          {series.map((point) => {
            const total = peak.compounded > 0 ? (point.compounded / peak.compounded) * 100 : 0;
            const flat = point.compounded > 0 ? (point.flat / point.compounded) * 100 : 0;
            return (
              <div
                key={point.year}
                className={`${styles.column} ${point.year === active.year ? styles.columnActive : ""}`}
                onMouseEnter={() => setHoverYear(point.year)}
              >
                <div className={styles.bar} style={{ height: `${Math.max(total, 0.8)}%` }}>
                  <div className={styles.barFlat} style={{ height: `${flat}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className={styles.axis}>
          <span>{copy.today}</span>
          <span>{copy.afterYears.replace("{years}", String(years))}</span>
        </div>
      </div>
    </div>
  );
}
