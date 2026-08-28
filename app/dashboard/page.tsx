"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import PortfolioChart, { type PortfolioHistoryPoint } from "@/app/components/portfolio-chart";
import StockChart from "@/app/components/stock-chart";
import UiState from "@/app/components/ui-state";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import styles from "./page.module.css";

type Position = {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  avgCost: number | null;
  // null when no live source could price the holding and synthetic fallback is
  // off. A null must never reach arithmetic: `0 + null` is 0 in JavaScript, so
  // an unpriced holding would silently count as worth nothing (ROADMAP §2.7).
  marketValue: number | null;
  positionValue?: number | null;
  currentPrice?: number | null;
  unrealizedPnl?: number | null;
  currency: string;
  accountType?: string | null;
  broker?: string | null;
  // Observed previous-close-vs-last change. null/undefined means "not available"
  // and must render as such — never as zero, and never as a derived stand-in.
  dayChangePct?: number | null;
  dayChangeAmount?: number | null;
  /** positionValue converted into the portfolio display currency, or null. */
  valueInDisplayCurrency?: number | null;
  // True when the price behind this row is a placeholder, not market data.
  synthetic?: boolean;
};

type Totals = {
  displayCurrency: string;
  total: number;
  positionCount: number;
  convertedCount: number;
  unconvertedCount: number;
  unconvertedCurrencies: string[];
  syntheticCount: number;
  unavailableCount: number;
};

export default function DashboardPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const locale = isSv ? "sv-SE" : "en-US";
  const router = useRouter();

  const [positions, setPositions] = useState<Position[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [history, setHistory] = useState<PortfolioHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    const portfolioResponse = await fetch("/api/portfolio/positions", { cache: "no-store" });
    // A dead session answers 401 with no positions, which is indistinguishable
    // from "you own nothing" once it reaches the render — and showing someone
    // "add your first holding" when they in fact have holdings is worse than
    // sending them back to sign in.
    if (portfolioResponse.status === 401) {
      router.replace("/auth/login?next=/dashboard");
      return;
    }
    const portfolioPayload = (await portfolioResponse.json().catch(() => ({}))) as {
      positions?: Position[];
      totals?: Totals;
    };
    setPositions(Array.isArray(portfolioPayload.positions) ? portfolioPayload.positions : []);
    setTotals(portfolioPayload.totals ?? null);
  }, [router]);

  const loadHistory = useCallback(async () => {
    // The chart is the one panel allowed to be empty on its own: history only
    // exists from the day the daily sweep first valued this portfolio, and a
    // failure here must not take the rest of the page down with it.
    try {
      const response = await fetch("/api/portfolio/history", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as { points?: PortfolioHistoryPoint[] };
      setHistory(Array.isArray(payload.points) ? payload.points : []);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadDashboard()
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load dashboard");
      })
      .finally(() => {
        if (cancelled) return;
        // Held until the first response lands: the first-run card and the KPI
        // panels are opposite answers to "what do you own", and flashing one
        // before the other is worse than a moment of nothing.
        setLoading(false);
      });
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [loadDashboard, loadHistory]);

  const displayCurrency = totals?.displayCurrency ?? "SEK";

  const money = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency: displayCurrency, maximumFractionDigits: 0 }),
    [locale, displayCurrency]
  );

  const formatIn = useCallback(
    (value: number, currency: string) =>
      new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(value),
    [locale]
  );

  const percentFormat = useMemo(
    () => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [locale]
  );

  const shareFormat = useMemo(
    () => new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    [locale]
  );

  const percent = useCallback(
    (value: number) => {
      const sign = value > 0 ? "+" : value < 0 ? "−" : "";
      return `${sign}${percentFormat.format(Math.abs(value))}%`;
    },
    [percentFormat]
  );

  const signedMoney = useCallback(
    (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${money.format(Math.abs(value))}`,
    [money]
  );

  /**
   * The FX rate a row was actually converted at, read back off the row.
   *
   * Re-deriving a rate here would be a second network call *and* a different
   * rate from the one the value was converted with, so the day change and the
   * value would disagree. The row already carries the answer — the same trick
   * `snapshot-value.ts` uses for the history writer.
   */
  const rateFor = useCallback((position: Position): number | null => {
    const local = position.positionValue ?? position.marketValue;
    if (position.valueInDisplayCurrency === null || position.valueInDisplayCurrency === undefined) return null;
    if (local === null || local === undefined || !Number.isFinite(local) || local <= 0) return null;
    return position.valueInDisplayCurrency / local;
  }, []);

  /** Day change in the display currency, over the rows that actually have one. */
  const dailyMove = useMemo(() => {
    const covered = positions
      .filter((position) => position.synthetic !== true)
      .map((position) => {
        const rate = rateFor(position);
        if (rate === null) return null;
        if (typeof position.dayChangeAmount !== "number" || !Number.isFinite(position.dayChangeAmount)) return null;
        if (typeof position.dayChangePct !== "number" || !Number.isFinite(position.dayChangePct)) return null;
        return {
          position,
          amount: position.dayChangeAmount * rate,
          pct: position.dayChangePct,
          valueNow: position.valueInDisplayCurrency as number
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (covered.length === 0) {
      return { available: false as const, coveredCount: 0 };
    }

    const amount = covered.reduce((sum, row) => sum + row.amount, 0);
    const previousValue = covered.reduce((sum, row) => sum + (row.valueNow - row.amount), 0);
    const sorted = covered.slice().sort((a, b) => b.pct - a.pct);

    return {
      available: true as const,
      amount,
      pct: previousValue > 0 ? (amount / previousValue) * 100 : null,
      best: sorted[0],
      // Never the same row as `best`: a one-holding portfolio has a best and no
      // worst, not the same name printed twice.
      worst: sorted.length > 1 ? sorted[sorted.length - 1] : null,
      coveredCount: covered.length
    };
  }, [positions, rateFor]);

  /** Return against cost basis, across exactly the rows whose cost we know. */
  const totalReturn = useMemo(() => {
    let costBasis = 0;
    let costedValue = 0;
    let coveredCount = 0;

    for (const position of positions) {
      const rate = rateFor(position);
      if (rate === null) continue;
      if (position.avgCost === null || !Number.isFinite(position.avgCost) || position.avgCost <= 0) continue;
      costBasis += position.quantity * position.avgCost * rate;
      costedValue += position.valueInDisplayCurrency as number;
      coveredCount += 1;
    }

    if (costBasis <= 0) {
      return { available: false as const, coveredCount: 0 };
    }

    return {
      available: true as const,
      amount: costedValue - costBasis,
      pct: ((costedValue - costBasis) / costBasis) * 100,
      coveredCount
    };
  }, [positions, rateFor]);

  const holdings = useMemo(
    () =>
      positions.slice().sort((a, b) => {
        const aValue = a.valueInDisplayCurrency ?? -1;
        const bValue = b.valueInDisplayCurrency ?? -1;
        return bValue - aValue;
      }),
    [positions]
  );

  const selected = useMemo(
    () => holdings.find((position) => position.id === selectedId) ?? null,
    [holdings, selectedId]
  );

  const hasPositions = positions.length > 0;
  const totalValue = totals?.total ?? null;
  const syntheticCount = totals?.syntheticCount ?? 0;

  const directionClass = (value: number) => (value > 0 ? styles.up : value < 0 ? styles.down : styles.flat);

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace title={isSv ? "Översikt" : "Dashboard"}>
        {loading ? <UiState kind="loading" message={isSv ? "Läser in din översikt..." : "Loading your dashboard..."} /> : null}

        {!loading && !hasPositions ? (
          <section className={`${styles.firstRun} appSection`} aria-label={isSv ? "Kom igång" : "Get started"}>
            <h2>{isSv ? "Lägg till ditt första innehav" : "Add your first holding"}</h2>
            <p className={styles.firstRunLead}>
              {isSv
                ? "Sök på bolaget och ange hur många aktier du har. Det tar tio sekunder — inköpspris är valfritt och kan fyllas i senare."
                : "Search for the company and enter how many shares you hold. It takes ten seconds — average cost is optional and can wait."}
            </p>
            <div className={styles.firstRunActions}>
              <Link className="appButton" href="/portfolio#add-holding">
                {isSv ? "Lägg till innehav" : "Add a holding"}
              </Link>
              <Link className={styles.firstRunLink} href="/portfolio#import-holdings">
                {isSv ? "Importera en fil eller koppla din bank" : "Import a file or connect your bank"}
              </Link>
            </div>
          </section>
        ) : null}

        {hasPositions ? (
          <>
            {syntheticCount > 0 ? (
              <p className={styles.syntheticNotice} role="status">
                <strong>{isSv ? "Platshållarkurser" : "Placeholder prices"}</strong>{" "}
                {isSv
                  ? `${syntheticCount} av ${positions.length} innehav prissätts just nu med platshållare, inte marknadsdata.`
                  : `${syntheticCount} of ${positions.length} holdings are currently priced with a placeholder, not market data.`}
              </p>
            ) : null}

            <section className={styles.kpis} aria-label={isSv ? "Nyckeltal" : "Key figures"}>
              <article className={`${styles.tile} ${styles.tileHero} appSection`}>
                <h2 className={styles.tileLabel}>{isSv ? "Totalt värde" : "Total value"}</h2>
                <p className={styles.hero}>{totalValue === null ? "—" : money.format(totalValue)}</p>
                {dailyMove.available ? (
                  <p className={`${styles.tileDelta} ${directionClass(dailyMove.amount)}`}>
                    {signedMoney(dailyMove.amount)}
                    {dailyMove.pct === null ? null : <span> {percent(dailyMove.pct)}</span>}{" "}
                    <span>{isSv ? "idag" : "today"}</span>
                  </p>
                ) : null}
                {totals && totals.unconvertedCount > 0 ? (
                  <p className={styles.coverage}>
                    {isSv
                      ? `Täcker ${totals.convertedCount} av ${totals.positionCount} innehav. ${totals.unconvertedCount} i ${totals.unconvertedCurrencies.join(", ")} kunde inte växlas och räknas inte in.`
                      : `Covers ${totals.convertedCount} of ${totals.positionCount} holdings. ${totals.unconvertedCount} in ${totals.unconvertedCurrencies.join(", ")} could not be converted and are excluded.`}
                  </p>
                ) : null}
              </article>

              <article className={`${styles.tile} appSection`}>
                <h2 className={styles.tileLabel}>{isSv ? "Idag" : "Today"}</h2>
                {dailyMove.available ? (
                  <>
                    <p className={`${styles.tileValue} ${directionClass(dailyMove.amount)}`}>
                      {dailyMove.pct === null ? signedMoney(dailyMove.amount) : percent(dailyMove.pct)}
                    </p>
                    <p className={styles.tileSub}>{signedMoney(dailyMove.amount)}</p>
                    <dl className={styles.movers}>
                      <div>
                        <dt>{isSv ? "Bäst" : "Best"}</dt>
                        <dd>
                          <span>{dailyMove.best.position.symbol}</span>
                          <strong className={directionClass(dailyMove.best.pct)}>{percent(dailyMove.best.pct)}</strong>
                        </dd>
                      </div>
                      {dailyMove.worst ? (
                        <div>
                          <dt>{isSv ? "Sämst" : "Worst"}</dt>
                          <dd>
                            <span>{dailyMove.worst.position.symbol}</span>
                            <strong className={directionClass(dailyMove.worst.pct)}>{percent(dailyMove.worst.pct)}</strong>
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  </>
                ) : (
                  <>
                    <p className={styles.tileUnavailable}>{isSv ? "Inte tillgängligt" : "Not available"}</p>
                    <p className={styles.coverage}>
                      {isSv
                        ? "Vi visar dagens rörelse först när en marknadskälla gett oss en föregående stängningskurs. Innehav från en depå kommer utan kurshistorik."
                        : "We show a daily move once a market source has given us a previous close. Holdings imported from a broker arrive without price history."}
                    </p>
                  </>
                )}
              </article>

              <article className={`${styles.tile} appSection`}>
                <h2 className={styles.tileLabel}>{isSv ? "Avkastning" : "Return"}</h2>
                {totalReturn.available ? (
                  <>
                    <p className={`${styles.tileValue} ${directionClass(totalReturn.amount)}`}>
                      {percent(totalReturn.pct)}
                    </p>
                    <p className={styles.tileSub}>{signedMoney(totalReturn.amount)}</p>
                    <p className={styles.coverage}>
                      {isSv
                        ? `Mot inköpspris, för ${totalReturn.coveredCount} av ${positions.length} innehav.`
                        : `Against cost basis, for ${totalReturn.coveredCount} of ${positions.length} holdings.`}
                    </p>
                  </>
                ) : (
                  <>
                    <p className={styles.tileUnavailable}>{isSv ? "Inget inköpspris" : "No cost basis"}</p>
                    <p className={styles.coverage}>
                      {isSv
                        ? "Ange inköpspris på dina innehav för att se avkastning."
                        : "Add an average cost to your holdings to see return."}
                    </p>
                  </>
                )}
              </article>
            </section>

            <PortfolioChart points={history} currency={displayCurrency} loading={historyLoading} />

            <section className={`${styles.holdings} appSection`} aria-label={isSv ? "Innehav" : "Holdings"}>
              <header className={styles.holdingsHead}>
                <h2 className={styles.tileLabel}>
                  {isSv ? "Innehav" : "Holdings"} <span>{positions.length}</span>
                </h2>
                <Link className={styles.quietLink} href="/portfolio">
                  {isSv ? "Hantera" : "Manage"}
                </Link>
              </header>

              <ul className={styles.rows}>
                {holdings.map((position) => {
                  const share =
                    totalValue && totalValue > 0 && typeof position.valueInDisplayCurrency === "number"
                      ? (position.valueInDisplayCurrency / totalValue) * 100
                      : null;
                  const open = position.id === selectedId;
                  return (
                    <li key={position.id}>
                      <button
                        type="button"
                        className={open ? `${styles.row} ${styles.rowOpen}` : styles.row}
                        aria-expanded={open}
                        aria-controls="position-detail"
                        onClick={() => setSelectedId(open ? null : position.id)}
                      >
                        <span className={styles.rowMain}>
                          <span className={styles.rowSymbol}>{position.symbol}</span>
                          <span className={styles.rowName}>
                            {position.name === position.symbol ? "" : position.name}
                            {position.name === position.symbol ? null : " · "}
                            {position.quantity.toLocaleString(locale)} {isSv ? "st" : "sh"}
                          </span>
                        </span>

                        <span className={styles.rowValue}>
                          {position.valueInDisplayCurrency === null || position.valueInDisplayCurrency === undefined
                            ? position.marketValue === null || position.marketValue === undefined
                              ? "—"
                              : formatIn(position.marketValue, position.currency)
                            : money.format(position.valueInDisplayCurrency)}
                          {share === null ? null : (
                            <span className={styles.rowShareText}>{shareFormat.format(share)}%</span>
                          )}
                        </span>

                        <span
                          className={`${styles.rowDay} ${
                            typeof position.dayChangePct === "number" ? directionClass(position.dayChangePct) : styles.flat
                          }`}
                        >
                          {position.synthetic === true
                            ? isSv
                              ? "platshållare"
                              : "placeholder"
                            : typeof position.dayChangePct === "number" && Number.isFinite(position.dayChangePct)
                              ? percent(position.dayChangePct)
                              : "—"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {selected ? (
              <section id="position-detail" className={`${styles.detail} appSection`} aria-label={selected.symbol}>
                <header className={styles.detailHead}>
                  <div>
                    <h2 className={styles.detailTitle}>{selected.symbol}</h2>
                    <p className={styles.detailSub}>
                      {selected.name === selected.symbol ? null : `${selected.name} · `}
                      {selected.quantity.toLocaleString(locale)} {isSv ? "aktier" : "shares"}
                      {selected.accountType ? ` · ${selected.accountType}` : ""}
                    </p>
                  </div>
                  <button type="button" className={styles.quietLink} onClick={() => setSelectedId(null)}>
                    {isSv ? "Stäng" : "Close"}
                  </button>
                </header>

                <dl className={styles.facts}>
                  <div>
                    <dt>{isSv ? "Kurs" : "Price"}</dt>
                    <dd>
                      {typeof selected.currentPrice === "number"
                        ? formatIn(selected.currentPrice, selected.currency)
                        : isSv
                          ? "Saknas"
                          : "Unavailable"}
                    </dd>
                  </div>
                  <div>
                    <dt>{isSv ? "Inköpspris" : "Avg. cost"}</dt>
                    <dd>{selected.avgCost === null ? "—" : formatIn(selected.avgCost, selected.currency)}</dd>
                  </div>
                  <div>
                    <dt>{isSv ? "Värde" : "Value"}</dt>
                    <dd>
                      {selected.marketValue === null || selected.marketValue === undefined
                        ? "—"
                        : formatIn(selected.marketValue, selected.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt>{isSv ? "Orealiserat" : "Unrealised"}</dt>
                    <dd
                      className={
                        typeof selected.unrealizedPnl === "number" ? directionClass(selected.unrealizedPnl) : undefined
                      }
                    >
                      {typeof selected.unrealizedPnl === "number"
                        ? `${selected.unrealizedPnl > 0 ? "+" : selected.unrealizedPnl < 0 ? "−" : ""}${formatIn(Math.abs(selected.unrealizedPnl), selected.currency)}`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{isSv ? "Idag" : "Today"}</dt>
                    <dd
                      className={
                        typeof selected.dayChangePct === "number" ? directionClass(selected.dayChangePct) : undefined
                      }
                    >
                      {selected.synthetic === true
                        ? isSv
                          ? "Platshållare"
                          : "Placeholder"
                        : typeof selected.dayChangePct === "number" && Number.isFinite(selected.dayChangePct)
                          ? percent(selected.dayChangePct)
                          : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{isSv ? "Källa" : "Source"}</dt>
                    <dd>{selected.broker ?? (isSv ? "Manuellt" : "Manual")}</dd>
                  </div>
                </dl>

                <StockChart symbol={selected.symbol} name={selected.name === selected.symbol ? null : selected.name} />
              </section>
            ) : null}
          </>
        ) : null}

        {error ? <p className={styles.error}>{error}</p> : null}
      </Workspace>
    </main>
  );
}
