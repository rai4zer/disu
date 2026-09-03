"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import PortfolioChart, { type PortfolioHistoryPoint } from "@/app/components/portfolio-chart";
import StockChart from "@/app/components/stock-chart";
import UiState from "@/app/components/ui-state";
import Workspace from "@/app/components/workspace";
import { useLanguage } from "@/app/i18n/language";
import MarketCards from "./market-cards";
import MoversCard from "./movers-card";
import ShortcutsCard from "./shortcuts-card";
import ValueCard from "./value-card";
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

  const directionClass = (value: number) => (value > 0 ? "dsUp" : value < 0 ? "dsDown" : "dsFlat");

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace title={isSv ? "Översikt" : "Dashboard"}>
        {loading ? <UiState kind="loading" message={isSv ? "Läser in din översikt..." : "Loading your dashboard..."} /> : null}

        {!loading && !hasPositions ? (
          <section className={`dsCard ${styles.firstRun}`} aria-label={isSv ? "Kom igång" : "Get started"}>
            <h2 className={styles.firstRunTitle}>{isSv ? "Lägg till ditt första innehav" : "Add your first holding"}</h2>
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

            {/*
              The hero row: what it is worth and how the year has gone, what
              moved most in money, and where to go next. Three cards rather than
              one wide panel because they answer three different questions, and
              a reader arrives with one of them in mind.
            */}
            <section className={styles.hero} aria-label={isSv ? "Översikt" : "Overview"}>
              <ValueCard
                points={history}
                totalValue={totalValue}
                currency={displayCurrency}
                loading={historyLoading}
              />
              <MoversCard
                positions={positions}
                currency={displayCurrency}
                loading={loading}
                rateFor={rateFor}
              />
              <ShortcutsCard />
            </section>

            <PortfolioChart points={history} currency={displayCurrency} loading={historyLoading} />

            <section className={`dsCard ${styles.holdings}`} aria-label={isSv ? "Innehav" : "Holdings"}>
              <header className="dsCardHeader">
                <h2 className="dsCardTitle">
                  {isSv ? "Innehav" : "Holdings"} · {positions.length}
                </h2>
                <Link className="dsCardAction" href="/portfolio">
                  {isSv ? "Hantera" : "Manage"}
                </Link>
              </header>

              <ul className={`dsRows ${styles.holdingRows}`}>
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
                        className={`dsRow ${styles.row} ${open ? styles.rowOpen : ""}`}
                        aria-expanded={open}
                        aria-controls="position-detail"
                        onClick={() => setSelectedId(open ? null : position.id)}
                      >
                        <span className="dsRowLabel">
                          <span className="dsRowName">{position.symbol}</span>
                          <span className="dsRowMeta">
                            {position.name === position.symbol ? "" : `${position.name} · `}
                            {position.quantity.toLocaleString(locale)} {isSv ? "st" : "sh"}
                            {share === null ? "" : ` · ${shareFormat.format(share)}%`}
                          </span>
                        </span>

                        <span className="dsRowValue">
                          <span className="dsNum">
                            {position.valueInDisplayCurrency === null || position.valueInDisplayCurrency === undefined
                              ? position.marketValue === null || position.marketValue === undefined
                                ? "—"
                                : formatIn(position.marketValue, position.currency)
                              : money.format(position.valueInDisplayCurrency)}
                          </span>
                          <span
                            className={`dsDelta ${
                              position.synthetic === true
                                ? "dsFlat"
                                : typeof position.dayChangePct === "number"
                                  ? directionClass(position.dayChangePct)
                                  : "dsFlat"
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
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {selected ? (
              <section id="position-detail" className={`dsCard ${styles.detail}`} aria-label={selected.symbol}>
                <header className={styles.detailHead}>
                  <div>
                    <h2 className={styles.detailTitle}>{selected.symbol}</h2>
                    <p className={styles.detailSub}>
                      {selected.name === selected.symbol ? null : `${selected.name} · `}
                      {selected.quantity.toLocaleString(locale)} {isSv ? "aktier" : "shares"}
                      {selected.accountType ? ` · ${selected.accountType}` : ""}
                    </p>
                  </div>
                  <button type="button" className="dsCardAction" onClick={() => setSelectedId(null)}>
                    {isSv ? "Stäng" : "Close"}
                  </button>
                </header>

                <dl className={styles.facts}>
                  <div className="dsWell">
                    <dt>{isSv ? "Kurs" : "Price"}</dt>
                    <dd>
                      {typeof selected.currentPrice === "number"
                        ? formatIn(selected.currentPrice, selected.currency)
                        : isSv
                          ? "Saknas"
                          : "Unavailable"}
                    </dd>
                  </div>
                  <div className="dsWell">
                    <dt>{isSv ? "Inköpspris" : "Avg. cost"}</dt>
                    <dd>{selected.avgCost === null ? "—" : formatIn(selected.avgCost, selected.currency)}</dd>
                  </div>
                  <div className="dsWell">
                    <dt>{isSv ? "Värde" : "Value"}</dt>
                    <dd>
                      {selected.marketValue === null || selected.marketValue === undefined
                        ? "—"
                        : formatIn(selected.marketValue, selected.currency)}
                    </dd>
                  </div>
                  <div className="dsWell">
                    <dt>{isSv ? "Orealiserat" : "Unrealised"}</dt>
                    <dd
                      className={
                        typeof selected.unrealizedPnl === "number"
                          ? styles[selected.unrealizedPnl > 0 ? "up" : selected.unrealizedPnl < 0 ? "down" : "flat"]
                          : undefined
                      }
                    >
                      {typeof selected.unrealizedPnl === "number"
                        ? `${selected.unrealizedPnl > 0 ? "+" : selected.unrealizedPnl < 0 ? "−" : ""}${formatIn(Math.abs(selected.unrealizedPnl), selected.currency)}`
                        : "—"}
                    </dd>
                  </div>
                  <div className="dsWell">
                    <dt>{isSv ? "Idag" : "Today"}</dt>
                    <dd
                      className={
                        typeof selected.dayChangePct === "number"
                          ? styles[selected.dayChangePct > 0 ? "up" : selected.dayChangePct < 0 ? "down" : "flat"]
                          : undefined
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
                  <div className="dsWell">
                    <dt>{isSv ? "Källa" : "Source"}</dt>
                    <dd>{selected.broker ?? (isSv ? "Manuellt" : "Manual")}</dd>
                  </div>
                </dl>

                <StockChart symbol={selected.symbol} name={selected.name === selected.symbol ? null : selected.name} />
              </section>
            ) : null}
          </>
        ) : null}

        {/* The market rail renders for everyone, holdings or not: a brand new
            account should still land on something alive, and none of it depends
            on owning anything. */}
        <MarketCards />

        {error ? <p className={styles.error}>{error}</p> : null}
      </Workspace>
    </main>
  );
}
