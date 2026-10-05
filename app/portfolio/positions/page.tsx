"use client";

/**
 * Positions — every holding in one table.
 *
 * A breakdown rather than a workbench: sortable columns, portfolio weight, and
 * the same honesty rules the rest of the app runs on. A price that could not be
 * observed renders "—" and a placeholder price is labelled as one, because a
 * table is exactly where an unpriced row would otherwise pass for a real
 * valuation (docs/synthetic-data-policy.md).
 *
 * Editing still lives on the "My money" tab alongside the broker connections
 * that write these rows. Splitting the editable table out of that 1 300-line
 * page is worth doing, but it is a refactor of shared state rather than part of
 * this view, so this one links there instead of duplicating the controls.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import UiState from "@/app/components/ui-state";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import PortfolioTabs from "../portfolio-tabs";
import styles from "./page.module.css";
import { NUMBER_LOCALE } from "@/app/lib/format/number";

type Position = {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  avgCost: number | null;
  currency: string;
  currentPrice?: number | null;
  marketValue: number | null;
  positionValue?: number | null;
  unrealizedPnl?: number | null;
  valueInDisplayCurrency?: number | null;
  dayChangePct?: number | null;
  accountType?: string | null;
  broker?: string | null;
  synthetic?: boolean;
};

type Totals = {
  displayCurrency: string;
  total: number;
  positionCount: number;
  syntheticCount: number;
};

type SortKey = "value" | "symbol" | "day" | "return";

export default function PositionsPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";

  const [positions, setPositions] = useState<Position[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("value");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/portfolio/positions", { cache: "no-store" });
        if (response.status === 401) {
          window.location.href = "/auth/login?next=/portfolio/positions";
          return;
        }
        const payload = (await response.json()) as { positions?: Position[]; totals?: Totals };
        if (cancelled) return;
        setPositions(Array.isArray(payload.positions) ? payload.positions : []);
        setTotals(payload.totals ?? null);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Unable to load positions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const currency = totals?.displayCurrency ?? "SEK";
  const totalValue = totals?.total ?? null;

  const money = useMemo(
    () => new Intl.NumberFormat(NUMBER_LOCALE, { style: "currency", currency, maximumFractionDigits: 0 }),
    [currency]
  );

  const formatIn = useCallback(
    (value: number, rowCurrency: string) =>
      new Intl.NumberFormat(NUMBER_LOCALE, { style: "currency", currency: rowCurrency, maximumFractionDigits: 2 }).format(value),
    []
  );

  /** Return against cost, per row, in the row's own currency. */
  const returnPct = useCallback((position: Position): number | null => {
    if (position.avgCost === null || !Number.isFinite(position.avgCost) || position.avgCost <= 0) return null;
    const pnl = position.unrealizedPnl;
    if (typeof pnl !== "number" || !Number.isFinite(pnl)) return null;
    const basis = position.avgCost * position.quantity;
    return basis > 0 ? (pnl / basis) * 100 : null;
  }, []);

  const rows = useMemo(() => {
    const copy = positions.slice();
    // Unknowns sort last in every ordering rather than being treated as zero —
    // a row we could not measure is not a row that did nothing.
    const nullsLast = (value: number | null) => (value === null ? Number.NEGATIVE_INFINITY : value);

    switch (sort) {
      case "symbol":
        return copy.sort((a, b) => a.symbol.localeCompare(b.symbol));
      case "day":
        return copy.sort(
          (a, b) => nullsLast(b.dayChangePct ?? null) - nullsLast(a.dayChangePct ?? null)
        );
      case "return":
        return copy.sort((a, b) => nullsLast(returnPct(b)) - nullsLast(returnPct(a)));
      default:
        return copy.sort(
          (a, b) => nullsLast(b.valueInDisplayCurrency ?? null) - nullsLast(a.valueInDisplayCurrency ?? null)
        );
    }
  }, [positions, sort, returnPct]);

  const percent = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}%`;
  const deltaClass = (value: number | null) =>
    value === null ? "dsFlat" : value > 0 ? "dsUp" : value < 0 ? "dsDown" : "dsFlat";

  const sorts: Array<{ key: SortKey; label: string }> = [
    { key: "value", label: isSv ? "Värde" : "Value" },
    { key: "day", label: isSv ? "Idag" : "Today" },
    { key: "return", label: isSv ? "Avkastning" : "Return" },
    { key: "symbol", label: "A–Z" }
  ];

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Portfölj" : "Portfolio"}
        subtitle={isSv ? "Alla innehav, uppdelade." : "Every holding, broken down."}
      >
        <PortfolioTabs />

        {loading ? <UiState kind="loading" message={isSv ? "Läser in innehav…" : "Loading positions…"} /> : null}
        {error ? <UiState kind="error" message={error} /> : null}

        {!loading && !error && positions.length === 0 ? (
          <section className={`dsCard ${styles.empty}`}>
            <h2 className={styles.emptyTitle}>{isSv ? "Inga innehav ännu" : "No holdings yet"}</h2>
            <p className={styles.emptyLead}>
              {isSv
                ? "Lägg till ett innehav manuellt, importera en fil eller koppla din bank."
                : "Add a holding by hand, import a file, or connect your bank."}
            </p>
            <Link className="appButton" href="/portfolio#add-holding">
              {isSv ? "Lägg till innehav" : "Add a holding"}
            </Link>
          </section>
        ) : null}

        {!loading && !error && positions.length > 0 ? (
          <section className={`dsCard ${styles.tableCard}`}>
            <header className={styles.tableHead}>
              <h2 className="dsCardTitle">
                {isSv ? "Innehav" : "Holdings"} · {positions.length}
              </h2>
              <div className={styles.tableTools}>
                <div className="dsSegmented" role="group" aria-label={isSv ? "Sortera" : "Sort"}>
                  {sorts.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`dsSegment ${sort === option.key ? "dsSegmentActive" : ""}`}
                      aria-pressed={sort === option.key}
                      onClick={() => setSort(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <Link className="dsCardAction" href="/portfolio#add-holding">
                  {isSv ? "Hantera" : "Manage"}
                </Link>
              </div>
            </header>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{isSv ? "Innehav" : "Holding"}</th>
                    <th scope="col" className={styles.numeric}>{isSv ? "Antal" : "Shares"}</th>
                    <th scope="col" className={styles.numeric}>{isSv ? "Kurs" : "Price"}</th>
                    <th scope="col" className={styles.numeric}>{isSv ? "Värde" : "Value"}</th>
                    <th scope="col" className={styles.numeric}>{isSv ? "Andel" : "Weight"}</th>
                    <th scope="col" className={styles.numeric}>{isSv ? "Idag" : "Today"}</th>
                    <th scope="col" className={styles.numeric}>{isSv ? "Avkastning" : "Return"}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((position) => {
                    const weight =
                      totalValue && totalValue > 0 && typeof position.valueInDisplayCurrency === "number"
                        ? (position.valueInDisplayCurrency / totalValue) * 100
                        : null;
                    const ret = returnPct(position);
                    const day =
                      typeof position.dayChangePct === "number" && Number.isFinite(position.dayChangePct)
                        ? position.dayChangePct
                        : null;

                    return (
                      <tr key={position.id}>
                        <td>
                          <span className={styles.symbol}>{position.symbol}</span>
                          <span className={styles.rowMeta}>
                            {position.name === position.symbol ? "" : position.name}
                            {position.accountType ? ` · ${position.accountType.toUpperCase()}` : ""}
                            {position.broker ? ` · ${position.broker}` : ""}
                          </span>
                        </td>
                        <td className={styles.numeric}>{position.quantity.toLocaleString(NUMBER_LOCALE)}</td>
                        <td className={styles.numeric}>
                          {position.synthetic === true ? (
                            <span className="dsDelta dsFlat">{isSv ? "platshållare" : "placeholder"}</span>
                          ) : typeof position.currentPrice === "number" ? (
                            formatIn(position.currentPrice, position.currency)
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className={styles.numeric}>
                          {typeof position.valueInDisplayCurrency === "number"
                            ? money.format(position.valueInDisplayCurrency)
                            : position.marketValue === null || position.marketValue === undefined
                              ? "—"
                              : formatIn(position.marketValue, position.currency)}
                        </td>
                        <td className={styles.numeric}>{weight === null ? "—" : `${weight.toFixed(1)}%`}</td>
                        <td className={styles.numeric}>
                          <span className={`dsDelta ${deltaClass(position.synthetic === true ? null : day)}`}>
                            {position.synthetic === true || day === null ? "—" : percent(day)}
                          </span>
                        </td>
                        <td className={styles.numeric}>
                          <span className={`dsDelta ${deltaClass(ret)}`}>{ret === null ? "—" : percent(ret)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totals && totals.syntheticCount > 0 ? (
              <p className={styles.note}>
                {isSv
                  ? `${totals.syntheticCount} av ${positions.length} innehav prissätts med platshållare, inte marknadsdata, och räknas inte in i totalen.`
                  : `${totals.syntheticCount} of ${positions.length} holdings are priced with a placeholder rather than market data, and are excluded from the total.`}
              </p>
            ) : null}
          </section>
        ) : null}
      </Workspace>
    </main>
  );
}
