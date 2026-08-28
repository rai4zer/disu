import { listConnections, listPositions } from "@/app/lib/brokers/store";
import type { Position } from "@/app/lib/brokers/types";
import {
  computeDayChange,
  convertAmount,
  getDisplayCurrency,
  tryGetQuoteInCurrency
} from "@/app/lib/market/market-provider";
import { listManualPositions, type ManualAccountType } from "@/app/lib/portfolio/manual-store";

export type PortfolioPosition = {
  id: string;
  source: "broker" | "manual";
  ticker: string;
  symbol: string;
  name: string;
  shares: number;
  quantity: number;
  avgCost: number | null;
  /**
   * `null` when no live source could price the holding and synthetic fallback
   * is off (MARKET_MOCK_FALLBACK_MODE). The holding is still the user's, so the
   * row is still shown — with the price rendered as unavailable rather than as
   * a hash-derived number wearing a disclaimer (ROADMAP §2.7).
   */
  currentPrice: number | null;
  positionValue: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  accountType: ManualAccountType | null;
  broker: string | null;
  currency: string;
  asOf: string;
  connectionId: string | null;
  /** Previous official close in `currency`, or null when the feed has none. */
  previousClose: number | null;
  /**
   * Observed previous-close-vs-last day change. `null` means "not available" —
   * the UI must render an explicit unavailable state, never a substitute value.
   */
  dayChangePct: number | null;
  dayChangeAmount: number | null;
  /** Where `currentPrice` came from. */
  priceSource: "yahoo" | "finnhub" | "placeholder" | "broker" | "unavailable";
  /**
   * True when `currentPrice` (and everything derived from it) was not observed
   * from a market feed. See docs/synthetic-data-policy.md.
   */
  synthetic: boolean;
  /**
   * `positionValue` converted into the portfolio display currency, or `null`
   * when no FX rate was available.
   *
   * Null is load-bearing. Totals sum this field, so a row that could not be
   * converted is *excluded and counted* rather than added at face value —
   * adding an unconverted USD figure to a SEK total is the bug this field
   * exists to prevent (ROADMAP §2.7, D5).
   */
  valueInDisplayCurrency: number | null;
};

/**
 * A portfolio total, with the honesty attached.
 *
 * `total` covers exactly `convertedCount` of `positionCount` holdings. Anything
 * that could not be converted is reported, never folded in — the UI must say so
 * rather than showing a number that quietly means less than it appears to.
 */
export type PortfolioTotals = {
  displayCurrency: string;
  total: number;
  positionCount: number;
  convertedCount: number;
  unconvertedCount: number;
  /** Currencies present that could not be converted, for the disclosure text. */
  unconvertedCurrencies: string[];
  /** Holdings whose price is a placeholder, so the total is partly synthetic. */
  syntheticCount: number;
  /**
   * Holdings no live source could price at all.
   *
   * Distinct from `unconvertedCount`: that one has a real price in a currency
   * we could not convert; this one has no price. Both are excluded from the
   * total, and the UI states them separately because the fix differs — one is
   * a missing FX rate, the other a dead ticker or an upstream outage.
   */
  unavailableCount: number;
};

function mapBrokerPosition(row: Position, brokerName: string | null): PortfolioPosition {
  // valueInDisplayCurrency is filled in by withDisplayCurrency() below: FX needs
  // a network call, and doing it per row here would mean one lookup per holding
  // instead of one per distinct currency.
  const currentPrice = row.quantity > 0 ? row.marketValue / row.quantity : 0;
  const unrealizedPnl = row.avgCost > 0 ? row.quantity * (currentPrice - row.avgCost) : null;
  return {
    id: row.id,
    source: "broker",
    ticker: row.symbol,
    symbol: row.symbol,
    name: row.name,
    shares: row.quantity,
    quantity: row.quantity,
    avgCost: row.avgCost,
    currentPrice,
    positionValue: row.marketValue,
    marketValue: row.marketValue,
    unrealizedPnl,
    accountType: null,
    broker: brokerName,
    currency: row.currency,
    asOf: row.asOf,
    connectionId: row.connectionId,
    // Broker snapshots carry a valuation, not a price history — there is no
    // previous close to compare against, so no day change is available.
    previousClose: null,
    dayChangePct: null,
    dayChangeAmount: null,
    priceSource: "broker",
    synthetic: false,
    valueInDisplayCurrency: null
  };
}

/**
 * Fills in `valueInDisplayCurrency` for every row, one FX lookup per distinct
 * currency rather than one per holding.
 */
async function withDisplayCurrency(
  rows: PortfolioPosition[],
  displayCurrency: string
): Promise<PortfolioPosition[]> {
  const currencies = [...new Set(rows.map((row) => row.currency.trim().toUpperCase()))];
  const rates = new Map<string, number | null>();

  await Promise.all(
    currencies.map(async (currency) => {
      // Probing with 1 unit gives the rate and reuses the cache inside
      // convertAmount, so a failure here is a missing rate for the whole
      // currency rather than for one row.
      rates.set(currency, await convertAmount(1, currency, displayCurrency));
    })
  );

  return rows.map((row) => {
    const rate = rates.get(row.currency.trim().toUpperCase()) ?? null;
    return {
      ...row,
      valueInDisplayCurrency:
        rate === null || row.positionValue === null || !Number.isFinite(row.positionValue)
          ? null
          : Math.round(row.positionValue * rate * 100) / 100
    };
  });
}

/**
 * Totals the rows that could be converted, and reports what was left out.
 *
 * Deliberately not a bare number. The old total was a bare number and that is
 * precisely why it was wrong: there was nowhere to say "this covers 3 of your 5
 * holdings" (ROADMAP §2.7).
 */
export function summarisePortfolio(
  rows: PortfolioPosition[],
  displayCurrency: string
): PortfolioTotals {
  const converted = rows.filter((row) => row.valueInDisplayCurrency !== null);
  const unconverted = rows.filter((row) => row.valueInDisplayCurrency === null);

  return {
    displayCurrency,
    total: Math.round(converted.reduce((sum, row) => sum + (row.valueInDisplayCurrency ?? 0), 0) * 100) / 100,
    positionCount: rows.length,
    convertedCount: converted.length,
    unconvertedCount: unconverted.length,
    unconvertedCurrencies: [...new Set(unconverted.map((row) => row.currency.trim().toUpperCase()))].sort(),
    syntheticCount: rows.filter((row) => row.synthetic === true).length,
    unavailableCount: rows.filter((row) => row.priceSource === "unavailable").length
  };
}

export async function listPortfolioPositions(userId: string): Promise<PortfolioPosition[]> {
  const [connections, brokerPositions, manualPositions] = await Promise.all([
    listConnections(userId),
    listPositions(userId),
    listManualPositions(userId)
  ]);

  const brokerByConnectionId = new Map(connections.map((connection) => [connection.id, connection.broker]));
  const brokerRows = brokerPositions.map((row) => mapBrokerPosition(row, brokerByConnectionId.get(row.connectionId) ?? null));

  const manualRows = await Promise.all(
    manualPositions.map(async (row) => {
      const quote = await tryGetQuoteInCurrency(row.ticker, row.currency);
      if (!quote) {
        // No live price and no permission to invent one. Everything derived
        // from a price is null rather than zero: a zero-valued holding is a
        // fabricated fact, and it would silently drag the portfolio total down.
        return {
          id: row.id,
          source: "manual" as const,
          ticker: row.ticker,
          symbol: row.ticker,
          name: row.ticker,
          shares: row.shares,
          quantity: row.shares,
          avgCost: row.avgCost,
          currentPrice: null,
          positionValue: null,
          marketValue: null,
          unrealizedPnl: null,
          accountType: row.accountType,
          broker: row.broker,
          currency: row.currency,
          asOf: new Date().toISOString(),
          connectionId: null,
          previousClose: null,
          dayChangePct: null,
          dayChangeAmount: null,
          priceSource: "unavailable" as const,
          synthetic: false,
          valueInDisplayCurrency: null
        };
      }
      const positionValue = row.shares * quote.price;
      const unrealizedPnl = row.avgCost === null ? null : row.shares * (quote.price - row.avgCost);
      const dayChange = computeDayChange(quote, row.shares);
      return {
        id: row.id,
        source: "manual" as const,
        ticker: row.ticker,
        symbol: row.ticker,
        name: row.ticker,
        shares: row.shares,
        quantity: row.shares,
        avgCost: row.avgCost,
        currentPrice: quote.price,
        positionValue,
        marketValue: positionValue,
        unrealizedPnl,
        accountType: row.accountType,
        broker: row.broker,
        currency: quote.currency,
        asOf: quote.asOf,
        connectionId: null,
        previousClose: quote.previousClose,
        dayChangePct: dayChange?.pct ?? null,
        dayChangeAmount: dayChange?.amount ?? null,
        priceSource: quote.source,
        synthetic: quote.synthetic,
        valueInDisplayCurrency: null
      };
    })
  );

  const rows = [...manualRows, ...brokerRows].sort((a, b) => a.ticker.localeCompare(b.ticker));
  return withDisplayCurrency(rows, getDisplayCurrency());
}

/**
 * Positions plus the total, computed together so a caller cannot render a total
 * derived from a different rule than the rows it sits above.
 */
export async function listPortfolioWithTotals(
  userId: string
): Promise<{ positions: PortfolioPosition[]; totals: PortfolioTotals }> {
  const displayCurrency = getDisplayCurrency();
  const positions = await listPortfolioPositions(userId);
  return { positions, totals: summarisePortfolio(positions, displayCurrency) };
}
