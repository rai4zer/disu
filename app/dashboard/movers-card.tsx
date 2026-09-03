"use client";

/**
 * Best and worst holdings, in money rather than percent.
 *
 * The brief was specific about the unit: show the gain or loss "in actual local
 * currency". That is the right call — a 9% move on a 200 kr position and a 0.4%
 * move on a 400 000 kr position are the same sentence in percent and completely
 * different events in kronor, and it is the kronor the reader is trying to
 * find. Percent rides along as secondary text.
 *
 * The amounts are converted at the rate each row was *already* valued with,
 * read back off the row rather than fetched again — see `rateFor` on the
 * dashboard for why re-deriving would make the total and the movers disagree.
 *
 * Two windows, because "top gainers" is genuinely ambiguous and both readings
 * are real data the app already holds:
 *
 *   - **Today** — previous close against last, the same figure the "Today" tile
 *     totals. Only rows with an observed previous close qualify.
 *   - **Total** — unrealised profit and loss against cost basis. Only rows
 *     whose cost basis the user has actually entered qualify.
 *
 * A holding that does not qualify for a window is left out of that window
 * rather than ranked at zero. An unknown is not a flat day, and a holding with
 * no cost basis has no return — ranking either as 0 would seat an unknown in
 * the middle of a list whose entire meaning is the ordering
 * (docs/synthetic-data-policy.md).
 */

import { useMemo, useState } from "react";
import { useLanguage } from "@/app/i18n/language";
import styles from "./page.module.css";

export type MoverPosition = {
  id: string;
  symbol: string;
  name: string;
  currency: string;
  marketValue: number | null;
  positionValue?: number | null;
  valueInDisplayCurrency?: number | null;
  avgCost: number | null;
  quantity: number;
  unrealizedPnl?: number | null;
  dayChangeAmount?: number | null;
  dayChangePct?: number | null;
  synthetic?: boolean;
};

type Window = "today" | "total";

type Row = {
  id: string;
  symbol: string;
  name: string;
  /** In the display currency. */
  amount: number;
  pct: number | null;
};

const LIST_SIZE = 5;

export default function MoversCard({
  positions,
  currency,
  loading,
  rateFor
}: {
  positions: MoverPosition[];
  currency: string;
  loading: boolean;
  /** The FX rate each row was valued at, from the dashboard. */
  rateFor: (position: MoverPosition) => number | null;
}) {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const locale = isSv ? "sv-SE" : "en-US";
  const [window, setWindow] = useState<Window>("today");

  const money = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }),
    [locale, currency]
  );

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];

    for (const position of positions) {
      // A placeholder price cannot produce a real change in either window.
      if (position.synthetic === true) continue;

      const rate = rateFor(position);
      if (rate === null) continue;

      if (window === "today") {
        const amount = position.dayChangeAmount;
        if (typeof amount !== "number" || !Number.isFinite(amount)) continue;
        const pct = typeof position.dayChangePct === "number" && Number.isFinite(position.dayChangePct)
          ? position.dayChangePct
          : null;
        out.push({ id: position.id, symbol: position.symbol, name: position.name, amount: amount * rate, pct });
        continue;
      }

      const pnl = position.unrealizedPnl;
      if (typeof pnl !== "number" || !Number.isFinite(pnl)) continue;
      // Percent against what was actually paid, not against today's value.
      const basis =
        position.avgCost !== null && Number.isFinite(position.avgCost) && position.avgCost > 0
          ? position.avgCost * position.quantity
          : null;
      out.push({
        id: position.id,
        symbol: position.symbol,
        name: position.name,
        amount: pnl * rate,
        pct: basis === null || basis <= 0 ? null : (pnl / basis) * 100
      });
    }

    return out.sort((a, b) => b.amount - a.amount);
  }, [positions, rateFor, window]);

  // Only real risers rise and only real fallers fall: in a red portfolio the
  // fifth-best holding is still down, and listing it as a gainer would be a
  // green heading over a loss.
  const gainers = rows.filter((row) => row.amount > 0).slice(0, LIST_SIZE);
  const losers = rows
    .filter((row) => row.amount < 0)
    .slice(-LIST_SIZE)
    .reverse();

  const signedMoney = (value: number) =>
    `${value > 0 ? "+" : value < 0 ? "−" : ""}${money.format(Math.abs(value))}`;

  const renderList = (list: Row[], empty: string) => {
    if (list.length === 0) {
      return <p className={styles.moversEmpty}>{empty}</p>;
    }
    return (
      <ul className="dsRows">
        {list.map((row) => (
          <li key={row.id}>
            <div className={`dsRow ${styles.moverRow}`}>
              <span className="dsRowLabel">
                <span className="dsRowName">{row.symbol}</span>
                <span className="dsRowMeta">{row.name === row.symbol ? "" : row.name}</span>
              </span>
              <span className="dsRowValue">
                <span className={`dsNum ${row.amount > 0 ? styles.up : row.amount < 0 ? styles.down : styles.flat}`}>
                  {signedMoney(row.amount)}
                </span>
                {row.pct === null ? null : (
                  <span className="dsRowMeta">
                    {row.pct > 0 ? "+" : row.pct < 0 ? "−" : ""}
                    {Math.abs(row.pct).toFixed(2)}%
                  </span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  const waiting = isSv ? "Hämtar…" : "Loading…";

  return (
    <article className={`dsCard ${styles.moversCard}`}>
      <header className="dsCardHeader">
        <h2 className="dsCardTitle">{isSv ? "Bäst och sämst" : "Best and worst"}</h2>
        <div className="dsSegmented" role="tablist" aria-label={isSv ? "Period" : "Window"}>
          <button
            type="button"
            role="tab"
            aria-selected={window === "today"}
            className={`dsSegment ${window === "today" ? "dsSegmentActive" : ""}`}
            onClick={() => setWindow("today")}
          >
            {isSv ? "Idag" : "Today"}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={window === "total"}
            className={`dsSegment ${window === "total" ? "dsSegmentActive" : ""}`}
            onClick={() => setWindow("total")}
          >
            {isSv ? "Totalt" : "Total"}
          </button>
        </div>
      </header>

      <div className={styles.moversGroup}>
        <h3 className={styles.moversHeading}>{isSv ? "Bäst" : "Best"}</h3>
        {renderList(
          gainers,
          loading
            ? waiting
            : window === "today"
              ? isSv
                ? "Inget innehav är upp idag."
                : "Nothing is up today."
              : isSv
                ? "Inget innehav ligger på plus."
                : "Nothing is in profit."
        )}
      </div>

      <div className={styles.moversGroup}>
        <h3 className={styles.moversHeading}>{isSv ? "Sämst" : "Worst"}</h3>
        {renderList(
          losers,
          loading
            ? waiting
            : window === "today"
              ? isSv
                ? "Inget innehav är ned idag."
                : "Nothing is down today."
              : isSv
                ? "Inget innehav ligger på minus."
                : "Nothing is at a loss."
        )}
      </div>

      {/*
        The coverage line. Both windows exclude rows they cannot measure, and a
        reader comparing this card against their own holdings deserves to know
        how many were left out rather than concluding the app lost one.
      */}
      {!loading && positions.length > 0 ? (
        <p className={styles.moversNote}>
          {isSv
            ? `Täcker ${rows.length} av ${positions.length} innehav.`
            : `Covers ${rows.length} of ${positions.length} holdings.`}
          {window === "total" && rows.length < positions.length
            ? isSv
              ? " Innehav utan inköpspris räknas inte."
              : " Holdings without a cost basis are excluded."
            : ""}
        </p>
      ) : null}
    </article>
  );
}
