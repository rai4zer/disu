"use client";

/**
 * Analysis — how the portfolio has actually done.
 *
 * The brief asked for absolute returns, batting average, slugging average,
 * CAGR, annual dividends, and a split by country and by sector. Four of those
 * are computable from what the app holds today and three are not, and the page
 * says which is which rather than quietly rendering the four and leaving the
 * reader to wonder where the others went.
 *
 * **Computable now**
 *   - *Absolute return* — value against cost basis, over the holdings whose
 *     cost the user has entered.
 *   - *Batting average* — the share of holdings in profit. Properly this is
 *     measured over closed trades; there is no trade history yet, so it is
 *     measured over open positions and labelled as such. A number that means
 *     something slightly different from its textbook definition has to say so,
 *     or it is just a wrong number.
 *   - *Slugging average* — mean gain on winners divided by mean loss on losers.
 *     Same caveat, same label.
 *   - *By listing venue* — derived from the ticker suffix, which is where a
 *     share is listed and not necessarily where the company is from. Called
 *     "listing venue" for that reason: Investor AB on the Stockholm exchange is
 *     Swedish, but so is a US-listed ADR of a Swedish company, and this method
 *     cannot tell them apart.
 *
 * **Not computable, and why**
 *   - *CAGR* needs a holding period, and positions carry no acquisition date —
 *     `PortfolioPosition` has `avgCost` but nothing to say when it was paid.
 *   - *Annual dividends* need a dividend feed. `stock/dividend` returns 403 on
 *     the current Finnhub plan, for every symbol including US ones.
 *   - *By sector* needs a classification the app has no source for.
 *
 * All three are provider or schema gaps rather than missing arithmetic, so they
 * are listed on the page with what would close them. See ROADMAP D2.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import UiState from "@/app/components/ui-state";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import PortfolioTabs from "../portfolio-tabs";
import styles from "./page.module.css";

type Position = {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  avgCost: number | null;
  currency: string;
  marketValue: number | null;
  positionValue?: number | null;
  unrealizedPnl?: number | null;
  valueInDisplayCurrency?: number | null;
  synthetic?: boolean;
};

type Totals = {
  displayCurrency: string;
  total: number;
  positionCount: number;
};

/**
 * Where a ticker is listed, from its suffix.
 *
 * Deliberately conservative: a suffix we do not recognise returns null and the
 * holding is reported as unclassified rather than guessed into a bucket.
 */
const VENUES: Array<{ suffix: string; en: string; sv: string }> = [
  { suffix: ".ST", en: "Sweden", sv: "Sverige" },
  { suffix: ".OL", en: "Norway", sv: "Norge" },
  { suffix: ".CO", en: "Denmark", sv: "Danmark" },
  { suffix: ".HE", en: "Finland", sv: "Finland" },
  { suffix: ".DE", en: "Germany", sv: "Tyskland" },
  { suffix: ".PA", en: "France", sv: "Frankrike" },
  { suffix: ".AS", en: "Netherlands", sv: "Nederländerna" },
  { suffix: ".L", en: "United Kingdom", sv: "Storbritannien" },
  { suffix: ".SW", en: "Switzerland", sv: "Schweiz" },
  { suffix: ".TO", en: "Canada", sv: "Kanada" },
  { suffix: ".HK", en: "Hong Kong", sv: "Hongkong" }
];

function venueOf(symbol: string, isSv: boolean): string | null {
  const upper = symbol.toUpperCase();
  for (const venue of VENUES) {
    if (upper.endsWith(venue.suffix)) return isSv ? venue.sv : venue.en;
  }
  // No suffix is a US listing in every feed this app talks to.
  if (!upper.includes(".")) return isSv ? "USA" : "United States";
  return null;
}

export default function AnalysisPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const locale = isSv ? "sv-SE" : "en-US";

  const [positions, setPositions] = useState<Position[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/portfolio/positions", { cache: "no-store" });
        if (response.status === 401) {
          window.location.href = "/auth/login?next=/portfolio/analysis";
          return;
        }
        const payload = (await response.json()) as { positions?: Position[]; totals?: Totals };
        if (cancelled) return;
        setPositions(Array.isArray(payload.positions) ? payload.positions : []);
        setTotals(payload.totals ?? null);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Unable to load analysis");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const currency = totals?.displayCurrency ?? "SEK";

  const money = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }),
    [locale, currency]
  );

  /** The rate a row was valued at, read back off the row. */
  const rateFor = useCallback((position: Position): number | null => {
    const local = position.positionValue ?? position.marketValue;
    if (position.valueInDisplayCurrency === null || position.valueInDisplayCurrency === undefined) return null;
    if (local === null || local === undefined || !Number.isFinite(local) || local <= 0) return null;
    return position.valueInDisplayCurrency / local;
  }, []);

  /**
   * Every metric below is computed over exactly the rows that qualify for it,
   * and each carries its own coverage count. A portfolio where half the rows
   * lack a cost basis has a real return figure over the other half — as long as
   * the reader is told it is half.
   */
  const stats = useMemo(() => {
    const costed: Array<{ pnl: number; basis: number }> = [];

    for (const position of positions) {
      if (position.synthetic === true) continue;
      const rate = rateFor(position);
      if (rate === null) continue;
      if (position.avgCost === null || !Number.isFinite(position.avgCost) || position.avgCost <= 0) continue;
      const pnl = position.unrealizedPnl;
      if (typeof pnl !== "number" || !Number.isFinite(pnl)) continue;
      costed.push({ pnl: pnl * rate, basis: position.avgCost * position.quantity * rate });
    }

    if (costed.length === 0) {
      return { available: false as const, covered: 0, total: positions.length };
    }

    const totalPnl = costed.reduce((sum, row) => sum + row.pnl, 0);
    const totalBasis = costed.reduce((sum, row) => sum + row.basis, 0);
    const winners = costed.filter((row) => row.pnl > 0);
    const losers = costed.filter((row) => row.pnl < 0);

    const averageWin = winners.length > 0 ? winners.reduce((s, r) => s + r.pnl, 0) / winners.length : null;
    const averageLoss = losers.length > 0 ? Math.abs(losers.reduce((s, r) => s + r.pnl, 0)) / losers.length : null;

    return {
      available: true as const,
      covered: costed.length,
      total: positions.length,
      absolute: totalPnl,
      absolutePct: totalBasis > 0 ? (totalPnl / totalBasis) * 100 : null,
      batting: (winners.length / costed.length) * 100,
      winners: winners.length,
      losers: losers.length,
      averageWin,
      averageLoss,
      // Undefined when there are no losers: dividing by nothing is not an
      // infinite slugging ratio, it is an unmeasured one.
      slugging: averageWin !== null && averageLoss !== null && averageLoss > 0 ? averageWin / averageLoss : null
    };
  }, [positions, rateFor]);

  /** Value by listing venue, in the display currency. */
  const venues = useMemo(() => {
    const buckets = new Map<string, number>();
    let unclassified = 0;
    let classifiedTotal = 0;

    for (const position of positions) {
      const value = position.valueInDisplayCurrency;
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const venue = venueOf(position.symbol, isSv);
      if (venue === null) {
        unclassified += value;
        continue;
      }
      buckets.set(venue, (buckets.get(venue) ?? 0) + value);
      classifiedTotal += value;
    }

    const rows = [...buckets.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

    return { rows, unclassified, classifiedTotal };
  }, [positions, isSv]);

  const percent = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}%`;
  const signedMoney = (value: number) =>
    `${value > 0 ? "+" : value < 0 ? "−" : ""}${money.format(Math.abs(value))}`;

  const gaps = [
    {
      title: isSv ? "CAGR" : "CAGR",
      why: isSv
        ? "Kräver ett anskaffningsdatum per innehav. Innehav lagras med inköpspris men utan datum, så det finns ingen tidsperiod att räkna på."
        : "Needs an acquisition date per holding. Positions store a cost but no date, so there is no period to annualise over.",
      unlock: isSv ? "Ett datumfält på innehav." : "A date field on holdings."
    },
    {
      title: isSv ? "Utdelningar per år" : "Dividends per year",
      why: isSv
        ? "Kräver en utdelningskälla. Nuvarande marknadsdataplan svarar 403 på utdelningar, även för amerikanska bolag."
        : "Needs a dividend feed. The current market-data plan answers 403 for dividends, US symbols included.",
      unlock: isSv ? "Licensierad marknadsdata (ROADMAP D2)." : "The licensed market-data feed (ROADMAP D2)."
    },
    {
      title: isSv ? "Fördelning per sektor" : "Split by sector",
      why: isSv
        ? "Kräver en sektorklassificering per bolag, som appen inte har någon källa till idag."
        : "Needs a sector classification per company, which the app has no source for today.",
      unlock: isSv ? "Licensierad marknadsdata (ROADMAP D2)." : "The licensed market-data feed (ROADMAP D2)."
    }
  ];

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace
        title={isSv ? "Portfölj" : "Portfolio"}
        subtitle={isSv ? "Hur portföljen har gått." : "How the portfolio has performed."}
      >
        <PortfolioTabs />

        {loading ? <UiState kind="loading" message={isSv ? "Räknar…" : "Crunching…"} /> : null}
        {error ? <UiState kind="error" message={error} /> : null}

        {!loading && !error ? (
          <>
            <section className={styles.metrics} aria-label={isSv ? "Nyckeltal" : "Key figures"}>
              <article className={`dsCard ${styles.metric}`}>
                <h2 className="dsCardTitle">{isSv ? "Absolut avkastning" : "Absolute return"}</h2>
                {stats.available ? (
                  <>
                    <p className={`${styles.metricValue} ${stats.absolute > 0 ? styles.up : stats.absolute < 0 ? styles.down : ""}`}>
                      {signedMoney(stats.absolute)}
                    </p>
                    <p className={styles.metricSub}>
                      {stats.absolutePct === null ? "—" : percent(stats.absolutePct)}{" "}
                      {isSv ? "mot inköpspris" : "against cost basis"}
                    </p>
                  </>
                ) : (
                  <p className={styles.metricUnavailable}>{isSv ? "Inget inköpspris" : "No cost basis"}</p>
                )}
              </article>

              <article className={`dsCard ${styles.metric}`}>
                <h2 className="dsCardTitle">{isSv ? "Träffprocent" : "Batting average"}</h2>
                {stats.available ? (
                  <>
                    <p className={styles.metricValue}>{stats.batting.toFixed(0)}%</p>
                    <p className={styles.metricSub}>
                      {isSv
                        ? `${stats.winners} av ${stats.covered} innehav på plus`
                        : `${stats.winners} of ${stats.covered} holdings in profit`}
                    </p>
                  </>
                ) : (
                  <p className={styles.metricUnavailable}>—</p>
                )}
              </article>

              <article className={`dsCard ${styles.metric}`}>
                <h2 className="dsCardTitle">{isSv ? "Slaggenomsnitt" : "Slugging average"}</h2>
                {stats.available && stats.slugging !== null ? (
                  <>
                    <p className={styles.metricValue}>{stats.slugging.toFixed(2)}×</p>
                    <p className={styles.metricSub}>
                      {isSv
                        ? `Snittvinst ${money.format(stats.averageWin ?? 0)} mot snittförlust ${money.format(stats.averageLoss ?? 0)}`
                        : `Average win ${money.format(stats.averageWin ?? 0)} vs average loss ${money.format(stats.averageLoss ?? 0)}`}
                    </p>
                  </>
                ) : (
                  <>
                    <p className={styles.metricUnavailable}>—</p>
                    <p className={styles.metricSub}>
                      {isSv
                        ? "Behöver både vinnare och förlorare för att kunna räknas."
                        : "Needs both winners and losers before it can be computed."}
                    </p>
                  </>
                )}
              </article>
            </section>

            {/*
              Both averages above are measured over open positions, because
              there is no closed-trade history yet. Saying so once, plainly,
              beats three asterisks.
            */}
            {stats.available ? (
              <p className={styles.note}>
                {isSv
                  ? `Räknat på ${stats.covered} av ${stats.total} innehav — de som har ett inköpspris. Träff- och slaggenomsnitt mäts på öppna innehav, inte på avslutade affärer, eftersom det ännu inte finns någon affärshistorik.`
                  : `Computed over ${stats.covered} of ${stats.total} holdings — the ones with a cost basis. Batting and slugging are measured across open positions rather than closed trades, because there is no trade history yet.`}
              </p>
            ) : null}

            <section className={`dsCard ${styles.venues}`}>
              <header className="dsCardHeader">
                <h2 className="dsCardTitle">{isSv ? "Fördelning per handelsplats" : "Split by listing venue"}</h2>
              </header>
              {venues.rows.length === 0 ? (
                <p className={styles.metricSub}>
                  {isSv ? "Inga värderade innehav ännu." : "No valued holdings yet."}
                </p>
              ) : (
                <ul className="dsRows">
                  {venues.rows.map((row) => {
                    const share = venues.classifiedTotal > 0 ? (row.value / venues.classifiedTotal) * 100 : 0;
                    return (
                      <li key={row.label}>
                        <div className="dsRow">
                          <span className="dsRowLabel">
                            <span className="dsRowName">{row.label}</span>
                            <span className={styles.venueBar} aria-hidden="true">
                              <span className={styles.venueFill} style={{ width: `${share.toFixed(1)}%` }} />
                            </span>
                          </span>
                          <span className="dsRowValue">
                            <span className="dsNum">{money.format(row.value)}</span>
                            <span className="dsRowMeta">{share.toFixed(1)}%</span>
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className={styles.note}>
                {isSv
                  ? "Härlett från tickerns ändelse, alltså var aktien handlas — inte nödvändigtvis var bolaget hör hemma."
                  : "Derived from the ticker suffix — where the share trades, which is not necessarily where the company is from."}
              </p>
            </section>

            <section className={`dsCard ${styles.gaps}`}>
              <header className="dsCardHeader">
                <h2 className="dsCardTitle">{isSv ? "Inte tillgängligt ännu" : "Not available yet"}</h2>
              </header>
              <ul className={styles.gapList}>
                {gaps.map((gap) => (
                  <li key={gap.title} className={styles.gap}>
                    <p className={styles.gapTitle}>{gap.title}</p>
                    <p className={styles.gapWhy}>{gap.why}</p>
                    <p className={styles.gapUnlock}>
                      <span>{isSv ? "Kräver" : "Needs"}</span> {gap.unlock}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}
      </Workspace>
    </main>
  );
}
