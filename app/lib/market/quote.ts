// The quote contract and the synthetic-data rule that governs it.
//
// This module deliberately has no imports so it stays loadable by the node test
// runner (which does not resolve the "@/" tsconfig alias). Keep it dependency-free.
// See docs/synthetic-data-policy.md.

export type QuoteSnapshot = {
  symbol: string;
  currency: string;
  price: number;
  /**
   * Previous official close, when the upstream feed supplies one. `null` means
   * "we do not know" — never substitute a derived or estimated value here, or
   * every day-change built on top of it becomes fabricated.
   */
  previousClose: number | null;
  asOf: string;
  /**
   * Which feed the price came from. `placeholder` is the only synthetic one,
   * and it is only ever produced when MARKET_MOCK_FALLBACK_MODE permits it.
   */
  source: "yahoo" | "finnhub" | "placeholder";
  /**
   * True when `price` was not observed from a market feed. Callers must
   * propagate this to the API layer and the UI must render synthetic values
   * differently from observed ones.
   */
  synthetic: boolean;
};

export type DayChange = {
  pct: number;
  amount: number;
};

/**
 * Real previous-close-vs-last day change, or `null` when we cannot compute one
 * from observed data. Synthetic quotes never produce a day change: a change
 * derived from a fabricated price is itself fabricated.
 */
export function computeDayChange(quote: QuoteSnapshot, quantity: number): DayChange | null {
  if (quote.synthetic) return null;
  const previous = quote.previousClose;
  if (previous === null || !Number.isFinite(previous) || previous <= 0) return null;
  if (!Number.isFinite(quote.price) || quote.price <= 0) return null;
  return {
    pct: ((quote.price - previous) / previous) * 100,
    amount: (quote.price - previous) * quantity
  };
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (let idx = 0; idx < seed.length; idx += 1) {
    hash = (hash * 33 + seed.charCodeAt(idx)) >>> 0;
  }
  return hash;
}

function estimateBasePrice(symbol: string): number {
  const hash = hashSeed(symbol.toUpperCase().trim());
  return 18 + (hash % 430);
}

/**
 * Terminal fallback when every live feed fails. The price is invented, so the
 * snapshot says so — and carries no previous close to derive a change from.
 */
export function createPlaceholderQuote(symbol: string, currency: string): QuoteSnapshot {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const daySeed = `${normalizedSymbol}:${new Date().toISOString().slice(0, 10)}`;
  const base = estimateBasePrice(normalizedSymbol);
  const drift = (hashSeed(daySeed) % 1600) / 100 - 8;
  return {
    symbol: normalizedSymbol,
    currency,
    price: Math.max(0.01, Math.round((base + drift) * 100) / 100),
    previousClose: null,
    asOf: new Date().toISOString(),
    source: "placeholder",
    synthetic: true
  };
}
