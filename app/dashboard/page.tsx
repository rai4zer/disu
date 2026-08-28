"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  currentPrice?: number | null;
  currency: string;
  // Observed previous-close-vs-last change. null/undefined means "not available"
  // and must render as such — never as zero, and never as a derived stand-in.
  dayChangePct?: number | null;
  dayChangeAmount?: number | null;
  // True when the price behind this row is a placeholder, not market data.
  synthetic?: boolean;
};

// marketValue is narrowed too: the previous-value maths below subtracts the
// day change from it, and a null there would silently read as zero.
type CoveredPosition = Position & { dayChangePct: number; dayChangeAmount: number; marketValue: number };

// A first-run dashboard has nothing to show. Rather than render zeroed panels —
// which read as "your portfolio is worth 0 kr" — we show what the panels look
// like once a holding exists. These are fixed illustrative figures, never
// fetched, never mixed into a real total, and the panel says so on its face
// (docs/synthetic-data-policy.md: invented numbers must be labelled and must
// render differently from observed data).
const EXAMPLE_CURRENCY = "SEK";
const EXAMPLE_DAILY_MOVE = { amount: 1240, pct: 0.82 };
const EXAMPLE_MARKET_VALUE = { total: 152400, returnPct: 11.4 };
const EXAMPLE_MOVERS = [
  { symbol: "VOLV-B.ST", pct: 2.1 },
  { symbol: "ERIC-B.ST", pct: -1.3 }
];

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);
}

function percent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${Math.round(value * 100) / 100}%`;
}

export default function DashboardPage() {
  const { language } = useLanguage();
  const isSv = language === "sv";
  const router = useRouter();

  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    const portfolioPayload = (await portfolioResponse.json().catch(() => ({}))) as { positions?: Position[] };
    setPositions(Array.isArray(portfolioPayload.positions) ? portfolioPayload.positions : []);
  }, [router]);

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
    return () => {
      cancelled = true;
    };
  }, [loadDashboard]);

  /**
   * Holdings that actually have a value.
   *
   * Everything below aggregates over this rather than `positions`. A row whose
   * price could not be fetched is not worth zero — it is unknown, and the two
   * must not be added together.
   */
  const priced = useMemo(
    () =>
      positions.filter(
        (position): position is Position & { marketValue: number } =>
          typeof position.marketValue === "number" && Number.isFinite(position.marketValue)
      ),
    [positions]
  );

  const unpricedCount = positions.length - priced.length;

  // Totals are only meaningful inside a single currency, so we report on the
  // currency holding the most value and count the rest as excluded rather than
  // adding unconverted amounts together.
  const displayCurrency = useMemo(() => {
    const valueByCurrency = new Map<string, number>();
    for (const position of priced) {
      valueByCurrency.set(position.currency, (valueByCurrency.get(position.currency) ?? 0) + position.marketValue);
    }
    let chosen: string | null = null;
    let chosenValue = Number.NEGATIVE_INFINITY;
    for (const [currency, value] of valueByCurrency) {
      if (value > chosenValue) {
        chosen = currency;
        chosenValue = value;
      }
    }
    return chosen;
  }, [priced]);

  const inScope = useMemo(
    () => (displayCurrency === null ? [] : priced.filter((position) => position.currency === displayCurrency)),
    [priced, displayCurrency]
  );

  const syntheticCount = useMemo(() => positions.filter((position) => position.synthetic === true).length, [positions]);

  const dailyMove = useMemo(() => {
    const covered = inScope.filter(
      (position): position is CoveredPosition =>
        position.synthetic !== true &&
        typeof position.dayChangeAmount === "number" &&
        Number.isFinite(position.dayChangeAmount) &&
        typeof position.dayChangePct === "number" &&
        Number.isFinite(position.dayChangePct)
    );

    if (covered.length === 0) {
      return { available: false as const };
    }

    const totalAmount = covered.reduce((acc, row) => acc + row.dayChangeAmount, 0);
    const previousValue = covered.reduce((acc, row) => acc + (row.marketValue - row.dayChangeAmount), 0);
    const sorted = covered.slice().sort((a, b) => b.dayChangePct - a.dayChangePct);

    return {
      available: true as const,
      totalAmount,
      totalPct: previousValue > 0 ? (totalAmount / previousValue) * 100 : null,
      best: sorted.slice(0, 2),
      // Start after the "best" slice so a small portfolio never lists the same
      // holding as both its best and its worst performer.
      worst: sorted.slice(Math.max(2, sorted.length - 2)).reverse(),
      coveredCount: covered.length,
      excludedCount: positions.length - covered.length
    };
  }, [inScope, positions.length]);

  const marketValue = useMemo(() => {
    const totalNow = inScope.reduce((acc, row) => acc + row.marketValue, 0);
    // Return is computed only across holdings whose cost we actually know, so
    // the percentage compares like with like instead of silently treating an
    // unknown cost as break-even.
    const withCost = inScope.filter((row) => row.avgCost !== null && row.avgCost > 0);
    const costBasis = withCost.reduce((acc, row) => acc + row.quantity * (row.avgCost as number), 0);
    const valueOfCosted = withCost.reduce((acc, row) => acc + row.marketValue, 0);

    return {
      totalNow,
      returnPct: costBasis > 0 ? ((valueOfCosted - costBasis) / costBasis) * 100 : null,
      costCoverage: withCost.length,
      excludedCount: positions.length - inScope.length
    };
  }, [inScope, positions.length]);

  const currencyLabel = displayCurrency ?? "SEK";
  const hasPositions = positions.length > 0;

  return (
    <main className={`${styles.page} appPage`}>
      <Workspace title={isSv ? "Översikt" : "Dashboard"}>
        {syntheticCount > 0 ? (
          <p className={styles.syntheticNotice} role="status">
            <strong>{isSv ? "Platshållarkurser" : "Placeholder prices"}</strong>{" "}
            {isSv
              ? `${syntheticCount} av ${positions.length} innehav prissätts just nu med platshållare, inte marknadsdata. Värden och avkastning som bygger på dem är inte verkliga kurser.`
              : `${syntheticCount} of ${positions.length} holdings are currently priced with a placeholder, not market data. Values and returns based on them are not real prices.`}
          </p>
        ) : null}

        {loading ? (
          <UiState kind="loading" message={isSv ? "Läser in din översikt..." : "Loading your dashboard..."} />
        ) : null}

        {!loading && !hasPositions ? (
          <>
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

            <section className={styles.example} aria-label={isSv ? "Exempel på översikten" : "Example dashboard"}>
              <p className={styles.exampleNotice}>
                <span className={styles.exampleBadge}>{isSv ? "Exempel" : "Example"}</span>{" "}
                {isSv
                  ? "Påhittade siffror som visar hur översikten ser ut när du har innehav. Inte marknadsdata och inte dina siffror."
                  : "Made-up figures showing what the dashboard looks like once you hold something. Not market data, and not your numbers."}
              </p>
              <div className={styles.topGrid} aria-hidden="true">
                <article className={`${styles.panel} ${styles.examplePanel} appSection`}>
                  <h3>{isSv ? "Daglig rörelse" : "Daily Move"}</h3>
                  <p className={styles.kpi}>
                    {formatMoney(EXAMPLE_DAILY_MOVE.amount, EXAMPLE_CURRENCY)} <span>{percent(EXAMPLE_DAILY_MOVE.pct)}</span>
                  </p>
                  <div className={styles.twoCol}>
                    <div>
                      <h4>{isSv ? "Bästa tillgångar" : "Best assets"}</h4>
                      <p className={styles.assetRow}>
                        <span>{EXAMPLE_MOVERS[0].symbol}</span>
                        <strong>{percent(EXAMPLE_MOVERS[0].pct)}</strong>
                      </p>
                    </div>
                    <div>
                      <h4>{isSv ? "Svagaste tillgångar" : "Worst assets"}</h4>
                      <p className={styles.assetRow}>
                        <span>{EXAMPLE_MOVERS[1].symbol}</span>
                        <strong>{percent(EXAMPLE_MOVERS[1].pct)}</strong>
                      </p>
                    </div>
                  </div>
                </article>
                <article className={`${styles.panel} ${styles.examplePanel} appSection`}>
                  <h3>{isSv ? "Marknadsvärde" : "Market Value"}</h3>
                  <p className={styles.kpi}>
                    {formatMoney(EXAMPLE_MARKET_VALUE.total, EXAMPLE_CURRENCY)}{" "}
                    <span>
                      {percent(EXAMPLE_MARKET_VALUE.returnPct)} {isSv ? "mot inköpspris" : "vs. cost basis"}
                    </span>
                  </p>
                </article>
              </div>
            </section>
          </>
        ) : null}

        {hasPositions ? (
        <section className={styles.topGrid}>
          <article className={`${styles.panel} appSection`}>
            <h2>{isSv ? "Daglig rörelse" : "Daily Move"}</h2>
            {dailyMove.available ? (
              <>
                <p className={styles.kpi}>
                  {formatMoney(dailyMove.totalAmount, currencyLabel)}{" "}
                  <span>{dailyMove.totalPct === null ? "—" : percent(dailyMove.totalPct)}</span>
                </p>
                {dailyMove.excludedCount > 0 ? (
                  <p className={styles.coverage}>
                    {isSv
                      ? `Baserat på ${dailyMove.coveredCount} av ${positions.length} innehav. Resten saknar föregående stängningskurs i ${currencyLabel}.`
                      : `Based on ${dailyMove.coveredCount} of ${positions.length} holdings. The rest have no previous close in ${currencyLabel}.`}
                  </p>
                ) : null}
                <div className={styles.twoCol}>
                  <div>
                    <h3>{isSv ? "Bästa tillgångar" : "Best assets"}</h3>
                    {dailyMove.best.map((row) => (
                      <p key={`best-${row.id}`} className={styles.assetRow}>
                        <span>{row.symbol}</span>
                        <strong>{percent(row.dayChangePct)}</strong>
                      </p>
                    ))}
                  </div>
                  <div>
                    <h3>{isSv ? "Svagaste tillgångar" : "Worst assets"}</h3>
                    {dailyMove.worst.length === 0 ? (
                      <p className={styles.assetRow}>
                        <span>—</span>
                      </p>
                    ) : (
                      dailyMove.worst.map((row) => (
                        <p key={`worst-${row.id}`} className={styles.assetRow}>
                          <span>{row.symbol}</span>
                          <strong>{percent(row.dayChangePct)}</strong>
                        </p>
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className={styles.kpiUnavailable}>{isSv ? "Inte tillgängligt än" : "Not available yet"}</p>
                <p className={styles.unavailableNote}>
                  {/* Only reachable with holdings — the no-holdings case is the
                      first-run card above, not a panel full of dashes. */}
                  {isSv
                    ? "Daglig rörelse visas först när vi har en föregående stängningskurs från en marknadsdatakälla. Innehav som hämtas från en depå levereras utan kurshistorik."
                    : "We show a daily move once we have a previous close from a market data feed. Holdings imported from a broker arrive without price history."}
                </p>
              </>
            )}
          </article>

          <article className={`${styles.panel} appSection`}>
            <h2>{isSv ? "Marknadsvärde" : "Market Value"}</h2>
            <p className={styles.kpi}>
              {formatMoney(marketValue.totalNow, currencyLabel)}{" "}
              <span>
                {marketValue.returnPct === null
                  ? isSv
                    ? "avkastning saknas"
                    : "return unavailable"
                  : `${percent(marketValue.returnPct)} ${isSv ? "mot inköpspris" : "vs. cost basis"}`}
              </span>
            </p>
            {unpricedCount > 0 ? (
              <p className={styles.coverage}>
                {isSv
                  ? `Live marknadsdata saknas för ${unpricedCount} innehav — de räknas inte in.`
                  : `Live market data is unavailable for ${unpricedCount} holding(s) — they are not counted.`}
              </p>
            ) : null}
            {marketValue.excludedCount > 0 ? (
              <p className={styles.coverage}>
                {isSv
                  ? `Visar innehav i ${currencyLabel}. ${marketValue.excludedCount} innehav i annan valuta räknas inte in.`
                  : `Showing holdings in ${currencyLabel}. ${marketValue.excludedCount} holding(s) in another currency are not included.`}
              </p>
            ) : null}
            {marketValue.returnPct === null ? (
              <p className={styles.coverage}>
                {isSv
                  ? "Ange inköpspris på dina innehav för att se avkastning."
                  : "Add an average cost to your holdings to see return."}
              </p>
            ) : null}
            <p className={styles.unavailableNote}>
              {isSv
                ? "Värdegraf visas inte än. Vi började spara en daglig ögonblicksbild av portföljen den dag du lade till ditt första innehav — grafen kommer när det finns tillräckligt med historik."
                : "The value chart is not here yet. We started recording a daily snapshot of your portfolio the day you added your first holding — the chart follows once there is enough history to draw."}
            </p>
          </article>
        </section>
        ) : null}

        {error ? <p className={styles.error}>{error}</p> : null}
      </Workspace>
    </main>
  );
}
