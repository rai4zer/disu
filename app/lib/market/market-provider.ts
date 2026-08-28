import { buildTickerSuggestions } from "@/app/lib/ticker-suggestions";
import { computeDayChange, createPlaceholderQuote, type DayChange, type QuoteSnapshot } from "./quote";

export { computeDayChange };
export type { DayChange, QuoteSnapshot };

export type TickerSuggestion = {
  symbol: string;
  name: string;
  currency: string;
  label: string;
};

export interface MarketProvider {
  searchTickers(query: string, limit: number): Promise<TickerSuggestion[]>;
  /**
   * The quote in the instrument's **own** currency, whatever the feed reports.
   *
   * `fallbackCurrency` is a label for a *synthetic placeholder*, used only when
   * no real quote could be fetched and a number has to be invented. It is never
   * a conversion request, and it is never applied to an observed price.
   *
   * To get a price in a different currency, call `getQuoteInCurrency()`, which
   * applies an FX rate. This used to be a single `currency?` parameter that the
   * hybrid provider honoured by relabelling `currency` and leaving `price`
   * alone — a USD price stamped `SEK` (ROADMAP §2.7). Splitting the two
   * meanings removes the trap rather than documenting it.
   */
  getQuote(symbol: string, fallbackCurrency?: string): Promise<QuoteSnapshot>;
}

const CURATED_TICKERS: Array<{ symbol: string; name: string; currency: string }> = [
  { symbol: "AAPL", name: "Apple Inc", currency: "USD" },
  { symbol: "MSFT", name: "Microsoft Corp", currency: "USD" },
  { symbol: "NVDA", name: "NVIDIA Corp", currency: "USD" },
  { symbol: "TSLA", name: "Tesla Inc", currency: "USD" },
  { symbol: "AMZN", name: "Amazon.com Inc", currency: "USD" },
  { symbol: "ASML.AS", name: "ASML Holding NV", currency: "EUR" },
  { symbol: "MC.PA", name: "LVMH", currency: "EUR" },
  { symbol: "SAP.DE", name: "SAP SE", currency: "EUR" },
  { symbol: "NOVO-B.CO", name: "Novo Nordisk B", currency: "DKK" },
  { symbol: "EVO.ST", name: "Evolution AB", currency: "SEK" },
  { symbol: "VOLV-B.ST", name: "Volvo B", currency: "SEK" },
  { symbol: "DNB.OL", name: "DNB Bank ASA", currency: "NOK" },
  { symbol: "NESN.SW", name: "Nestle SA", currency: "CHF" },
  { symbol: "SHEL.L", name: "Shell plc", currency: "GBP" }
];

type YahooSearchResponse = {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    quoteType?: string;
    currency?: string;
  }>;
};

type YahooQuoteResponse = {
  quoteResponse?: {
    result?: Array<{
      symbol?: string;
      shortName?: string;
      longName?: string;
      currency?: string;
      regularMarketPrice?: number;
      regularMarketPreviousClose?: number;
      regularMarketTime?: number;
    }>;
  };
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        currency?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
  };
};

async function fetchYahooSuggestions(query: string, limit: number): Promise<TickerSuggestion[]> {
  const url = new URL("https://query2.finance.yahoo.com/v1/finance/search");
  url.searchParams.set("q", query);
  url.searchParams.set("quotesCount", String(Math.max(10, limit * 2)));
  url.searchParams.set("newsCount", "0");
  url.searchParams.set("enableFuzzyQuery", "true");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "FinanceAutomation/1.0"
    },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Yahoo search failed: ${response.status}`);
  }

  const json = (await response.json()) as YahooSearchResponse;
  const quotes = Array.isArray(json.quotes) ? json.quotes : [];
  return quotes
    .filter((quote) => {
      const symbol = String(quote.symbol ?? "").trim().toUpperCase();
      const type = String(quote.quoteType ?? "").toUpperCase();
      return symbol.length > 0 && symbol.length <= 16 && ["EQUITY", "ETF", "MUTUALFUND"].includes(type);
    })
    .map((quote) => {
      const symbol = String(quote.symbol ?? "").trim().toUpperCase();
      const name = String(quote.shortname ?? quote.longname ?? symbol).trim();
      const currency = String(quote.currency ?? "").trim().toUpperCase() || inferCurrencyFromTicker(symbol);
      return {
        symbol,
        name,
        currency,
        label: `${symbol} - ${name}`
      };
    })
    .filter((item, idx, arr) => arr.findIndex((x) => x.symbol === item.symbol) === idx)
    .slice(0, limit);
}

async function fetchYahooQuote(symbol: string): Promise<QuoteSnapshot> {
  const normalized = symbol.trim().toUpperCase();
  const url = new URL("https://query1.finance.yahoo.com/v7/finance/quote");
  url.searchParams.set("symbols", normalized);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "FinanceAutomation/1.0"
    },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Yahoo quote failed: ${response.status}`);
  }

  const json = (await response.json()) as YahooQuoteResponse;
  const result = json.quoteResponse?.result?.[0];
  const price = Number(result?.regularMarketPrice);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Yahoo quote missing regularMarketPrice");
  }

  const quoteTime = Number(result?.regularMarketTime);
  const asOf = Number.isFinite(quoteTime) ? new Date(quoteTime * 1000).toISOString() : new Date().toISOString();

  const previousCloseRaw = Number(result?.regularMarketPreviousClose);
  const previousClose = Number.isFinite(previousCloseRaw) && previousCloseRaw > 0 ? previousCloseRaw : null;

  return {
    symbol: String(result?.symbol ?? normalized).trim().toUpperCase(),
    currency: String(result?.currency ?? "").trim().toUpperCase() || inferCurrencyFromTicker(normalized),
    price,
    previousClose,
    asOf,
    source: "yahoo",
    synthetic: false
  };
}

async function fetchYahooChartQuote(symbol: string): Promise<QuoteSnapshot> {
  const normalized = symbol.trim().toUpperCase();
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normalized)}`);
  url.searchParams.set("range", "1d");
  url.searchParams.set("interval", "1m");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "FinanceAutomation/1.0"
    },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Yahoo chart quote failed: ${response.status}`);
  }

  const json = (await response.json()) as YahooChartResponse;
  const result = json.chart?.result?.[0];
  const meta = result?.meta;
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const lastClose = [...closes].reverse().find((value) => Number.isFinite(value) && Number(value) > 0);
  const price = Number(lastClose ?? meta?.regularMarketPrice ?? meta?.chartPreviousClose);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Yahoo chart quote missing usable price");
  }

  const timestamps = result?.timestamp ?? [];
  const lastTimestamp = timestamps[timestamps.length - 1];
  const asOf = Number.isFinite(lastTimestamp) ? new Date(lastTimestamp * 1000).toISOString() : new Date().toISOString();

  const previousCloseRaw = Number(meta?.previousClose ?? meta?.chartPreviousClose);
  const previousClose = Number.isFinite(previousCloseRaw) && previousCloseRaw > 0 ? previousCloseRaw : null;

  return {
    symbol: String(meta?.symbol ?? normalized).trim().toUpperCase(),
    currency: String(meta?.currency ?? "").trim().toUpperCase() || inferCurrencyFromTicker(normalized),
    price,
    previousClose,
    asOf,
    source: "yahoo",
    synthetic: false
  };
}

/**
 * Raised when no live source could price something and synthetic fallback is
 * switched off.
 *
 * A distinct type because callers must be able to tell "the market has no
 * number for this" apart from "the code broke". The first is a state the UI has
 * to render honestly; the second is a bug.
 */
export class MarketDataUnavailableError extends Error {
  readonly symbol: string;
  constructor(symbol: string, cause?: unknown) {
    super(`No live market data available for ${symbol}`);
    this.name = "MarketDataUnavailableError";
    this.symbol = symbol;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export type MarketFallbackMode = "never" | "offline" | "always";

/**
 * Whether a hash-derived placeholder price may stand in for a real one.
 *
 * Mirrors `QUANT_MOCK_FALLBACK_MODE` / `PRIMER_MOCK_FALLBACK_MODE` deliberately:
 * those two already let production refuse to serve an invented result, and
 * market data was the one path with no equivalent switch. Without it, a Yahoo
 * rate-limit in production silently turned every holding into a hash of its
 * ticker — flagged as synthetic, so not a lie, but a portfolio of placeholders
 * behind a small disclaimer is not a working product (ROADMAP §2.7).
 *
 * Production defaults to `never` even when the variable is unset. A missing
 * config value must fail closed: the cost of being wrong is showing someone
 * invented numbers about their own money.
 */
export function marketFallbackMode(): MarketFallbackMode {
  const raw = (process.env.MARKET_MOCK_FALLBACK_MODE ?? "").trim().toLowerCase();
  if (raw === "never") return "never";
  if (raw === "always") return "always";
  if (raw === "offline") return "offline";
  return process.env.NODE_ENV === "production" ? "never" : "offline";
}

export function syntheticFallbackAllowed(): boolean {
  return marketFallbackMode() !== "never";
}

// --- Finnhub ---------------------------------------------------------------
// The second live source. Yahoo's endpoints are unofficial and rate-limited
// (docs/market-live-feed.md), so a single 429 used to be the whole chain.
//
// COVERAGE, measured against the live API on 2026-08-27 with the current key:
//
//   /quote AAPL          -> 200, real data
//   /quote EVO.ST        -> 403 "You don't have access to this resource."
//   /quote VOLV-B.ST     -> 403
//   /forex/rates         -> 403
//
// So on this plan Finnhub is a failover for **US equities only**. Nordic
// tickers and every FX rate still have Yahoo as a single point of failure —
// which is most of what a Swedish portfolio is made of. The chain below is
// correct and will use Finnhub the moment the plan covers more; do not read it
// as evidence that the coverage gap in ROADMAP §2.7 is closed. It is not.

export function finnhubToken(): string | null {
  const token = (process.env.FINNHUB_API_KEY ?? "").trim();
  return token.length > 0 ? token : null;
}

/**
 * Reads a JSON body, refusing anything that is not actually JSON.
 *
 * Finnhub answers rate limits and auth failures with HTML or plain text, and
 * `JSON.parse` on an error page throws something unhelpful several frames away
 * from the cause. Shared with `app/api/market/indices/route.ts`, which had its
 * own copy.
 */
export async function readJsonResponse<T>(response: Response, source: string): Promise<T> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const bodyText = await response.text();
  if (!contentType.includes("application/json")) {
    throw new Error(`${source}: non-json response`);
  }
  try {
    return JSON.parse(bodyText) as T;
  } catch {
    throw new Error(`${source}: invalid json response`);
  }
}

export async function finnhubFetch<T>(pathAndQuery: string, source: string, signal?: AbortSignal): Promise<T> {
  const token = finnhubToken();
  if (!token) {
    throw new Error(`${source}: FINNHUB_API_KEY is not configured`);
  }
  const separator = pathAndQuery.includes("?") ? "&" : "?";
  const response = await fetch(
    `https://finnhub.io/api/v1${pathAndQuery}${separator}token=${encodeURIComponent(token)}`,
    { headers: { Accept: "application/json" }, cache: "no-store", signal }
  );
  if (!response.ok) {
    // 403 means "your plan does not include this", not "Finnhub is down".
    // Worth distinguishing: one is fixed by paying, the other by waiting, and a
    // log full of bare 403s reads like an outage.
    if (response.status === 403) {
      throw new Error(`${source}: not included in the current Finnhub plan (HTTP 403)`);
    }
    throw new Error(`${source}: HTTP ${response.status}`);
  }
  return readJsonResponse<T>(response, source);
}

type FinnhubQuoteResponse = {
  /** current price */
  c?: number;
  /** previous close */
  pc?: number;
  /** unix seconds */
  t?: number;
};

async function fetchFinnhubQuote(symbol: string): Promise<QuoteSnapshot> {
  const normalized = symbol.trim().toUpperCase();
  const json = await finnhubFetch<FinnhubQuoteResponse>(
    `/quote?symbol=${encodeURIComponent(normalized)}`,
    `finnhub quote ${normalized}`
  );

  const price = Number(json.c);
  // Finnhub answers an unknown symbol with a 200 and c=0 rather than an error.
  // Treating that as a price would put a zero-valued holding in someone's
  // portfolio, so it is a failure like any other.
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`finnhub quote ${normalized}: no usable price`);
  }

  const previousCloseRaw = Number(json.pc);
  const timestamp = Number(json.t);

  return {
    symbol: normalized,
    // Finnhub's /quote does not report a currency, so it is inferred from the
    // symbol. That inference is about the *instrument*, not a conversion.
    currency: inferCurrencyFromTicker(normalized),
    price,
    previousClose: Number.isFinite(previousCloseRaw) && previousCloseRaw > 0 ? previousCloseRaw : null,
    asOf: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
    source: "finnhub",
    synthetic: false
  };
}

type FinnhubForexResponse = { base?: string; quote?: Record<string, number> };

async function fetchFinnhubFxRate(base: string, quote: string): Promise<number> {
  const json = await finnhubFetch<FinnhubForexResponse>(
    `/forex/rates?base=${encodeURIComponent(base)}`,
    `finnhub fx ${base}${quote}`
  );
  const rate = Number(json.quote?.[quote]);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`finnhub fx ${base}${quote}: rate missing`);
  }
  return rate;
}

const fxRateCache = new Map<string, { rate: number; expiresAt: number }>();

async function getFxRate(baseCurrency: string, quoteCurrency: string): Promise<number> {
  const base = baseCurrency.trim().toUpperCase();
  const quote = quoteCurrency.trim().toUpperCase();
  if (!base || !quote || base === quote) {
    return 1;
  }

  const pair = `${base}${quote}=X`;
  const cached = fxRateCache.get(pair);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.rate;
  }

  // Yahoo first, then Finnhub. An FX rate is never synthesised: there is no
  // honest placeholder for "what is a dollar worth", and inventing one would
  // corrupt every converted total downstream while looking perfectly ordinary.
  const rate = await (async () => {
    try {
      const snapshot = await fetchYahooQuote(pair);
      if (Number.isFinite(snapshot.price) && snapshot.price > 0) {
        return snapshot.price;
      }
    } catch {
      // fall through to the chart endpoint, then Finnhub
    }
    try {
      const snapshot = await fetchYahooChartQuote(pair);
      if (Number.isFinite(snapshot.price) && snapshot.price > 0) {
        return snapshot.price;
      }
    } catch {
      // fall through to Finnhub
    }
    return fetchFinnhubFxRate(base, quote);
  })();

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`FX rate unavailable for ${pair}`);
  }

  fxRateCache.set(pair, { rate, expiresAt: Date.now() + 1000 * 60 * 10 });
  return rate;
}

/** Test seam: FX rates are cached for ten minutes and would leak across cases. */
export function __clearFxCacheForTests(): void {
  fxRateCache.clear();
}

/**
 * The one currency portfolio totals are expressed in (decision D5).
 *
 * A total is only a number if every term shares a unit. Before this existed the
 * portfolio page added SEK to USD and labelled the result with whichever row
 * happened to sort first, so the same holdings showed a different "total" after
 * a re-sort (ROADMAP §2.7).
 *
 * SEK because the audience is Swedish. Overridable per deployment, but not per
 * user: a per-user setting is a real feature with real UI, and picking one
 * correct default now beats shipping a wrong number while that is designed.
 */
export function getDisplayCurrency(): string {
  const configured = (process.env.PORTFOLIO_DISPLAY_CURRENCY ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(configured) ? configured : "SEK";
}

/**
 * Converts an amount between currencies, or returns null when no rate is
 * available.
 *
 * Null rather than a throw, and null rather than the unconverted number: a
 * total that silently includes one unconverted term is exactly the bug this
 * replaces. The caller has to decide what to do about a missing rate, and the
 * UI has to say so.
 */
export async function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): Promise<number | null> {
  if (!Number.isFinite(amount)) {
    return null;
  }
  const from = fromCurrency.trim().toUpperCase();
  const to = toCurrency.trim().toUpperCase();
  if (!from || !to) {
    return null;
  }
  if (from === to) {
    return amount;
  }
  try {
    const rate = await getFxRate(from, to);
    return Math.round(amount * rate * 100) / 100;
  } catch {
    return null;
  }
}

export async function getQuoteInCurrency(symbol: string, targetCurrency?: string): Promise<QuoteSnapshot> {
  const provider = getMarketProvider();
  const desiredCurrency = targetCurrency?.trim().toUpperCase();
  // Passed as the placeholder label, not as a conversion request: if the feed
  // fails and a number has to be invented, invent it in the currency the caller
  // wanted instead of inventing it in USD and then applying a real FX rate to a
  // fake price.
  const snapshot = await provider.getQuote(symbol, desiredCurrency);

  if (!desiredCurrency || desiredCurrency === snapshot.currency) {
    return snapshot;
  }

  const fxRate = await getFxRate(snapshot.currency, desiredCurrency);
  return {
    ...snapshot,
    currency: desiredCurrency,
    price: Math.round(snapshot.price * fxRate * 100) / 100,
    previousClose:
      snapshot.previousClose === null ? null : Math.round(snapshot.previousClose * fxRate * 100) / 100
  };
}

/**
 * `getQuoteInCurrency`, but `null` instead of a throw when nothing live exists.
 *
 * For callers pricing a *list*: one delisted or mistyped ticker must not take
 * the whole portfolio down with it. The null then travels all the way to the
 * row, which renders as unavailable — which is the point. A caller that wants
 * the error should use getQuoteInCurrency directly.
 */
export async function tryGetQuoteInCurrency(
  symbol: string,
  targetCurrency?: string
): Promise<QuoteSnapshot | null> {
  try {
    return await getQuoteInCurrency(symbol, targetCurrency);
  } catch (error) {
    if (error instanceof MarketDataUnavailableError) {
      return null;
    }
    // An FX failure after a good quote lands here too: the price is real but
    // cannot be expressed in the requested currency, and a row priced in the
    // wrong unit is worse than one marked unavailable.
    return null;
  }
}

export function inferCurrencyFromTicker(rawSymbol: string): string {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) return "USD";

  const curated = CURATED_TICKERS.find((item) => item.symbol === symbol);
  if (curated) return curated.currency;

  const suffix = symbol.split(".")[1] ?? "";
  if (suffix === "ST") return "SEK";
  if (suffix === "CO") return "DKK";
  if (suffix === "OL") return "NOK";
  if (suffix === "SW") return "CHF";
  if (["PA", "AS", "DE", "MI", "BR", "HE", "VI"].includes(suffix)) return "EUR";
  if (suffix === "L") return "GBP";
  return "USD";
}

class YahooMarketProvider implements MarketProvider {
  async searchTickers(query: string, limit: number): Promise<TickerSuggestion[]> {
    return fetchYahooSuggestions(query, limit);
  }

  async getQuote(symbol: string): Promise<QuoteSnapshot> {
    // Two endpoints, one source: v7 carries the currency and previous close,
    // v8 answers for symbols v7 refuses. Both are unofficial.
    try {
      return await fetchYahooQuote(symbol);
    } catch {
      return fetchYahooChartQuote(symbol);
    }
  }
}

class PlaceholderMarketProvider implements MarketProvider {
  async searchTickers(query: string, limit: number): Promise<TickerSuggestion[]> {
    const trimmed = query.trim().toLowerCase();
    const local = buildTickerSuggestions(query, limit * 2).map((item) => ({
      symbol: item.symbol,
      name: item.name,
      currency: inferCurrencyFromTicker(item.symbol),
      label: `${item.symbol} - ${item.name}`
    }));

    const curated = CURATED_TICKERS.filter((item) => {
      if (!trimmed) return true;
      const haystack = `${item.symbol} ${item.name}`.toLowerCase();
      return haystack.includes(trimmed);
    }).map((item) => ({
      symbol: item.symbol,
      name: item.name,
      currency: item.currency,
      label: `${item.symbol} - ${item.name}`
    }));

    return [...curated, ...local]
      .filter((item, idx, arr) => arr.findIndex((other) => other.symbol === item.symbol) === idx)
      .slice(0, limit);
  }

  async getQuote(symbol: string, fallbackCurrency?: string): Promise<QuoteSnapshot> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    // Nothing is being converted: the price does not exist, so minting it
    // directly in the requested currency is both correct and avoids applying an
    // FX rate to an invented number.
    const resolvedCurrency = fallbackCurrency?.trim().toUpperCase() || inferCurrencyFromTicker(normalizedSymbol);
    return createPlaceholderQuote(normalizedSymbol, resolvedCurrency);
  }
}

class FinnhubMarketProvider implements MarketProvider {
  async searchTickers(): Promise<TickerSuggestion[]> {
    // Finnhub's symbol search is a separate endpoint on a separate quota, and
    // search failing is a cosmetic problem where a wrong price is not. Not
    // implemented rather than half-implemented.
    return [];
  }

  async getQuote(symbol: string): Promise<QuoteSnapshot> {
    return fetchFinnhubQuote(symbol);
  }
}

/**
 * The live chain: Yahoo, then Finnhub, then — only where policy allows it — a
 * flagged placeholder.
 *
 * The order is deliberate. Yahoo covers Nordic tickers and reports a currency;
 * Finnhub is the documented, keyed source that keeps working when Yahoo
 * rate-limits (docs/market-live-feed.md). Neither is trusted to be up.
 */
class HybridMarketProvider implements MarketProvider {
  private yahoo = new YahooMarketProvider();
  private finnhub = new FinnhubMarketProvider();
  private placeholder = new PlaceholderMarketProvider();

  async searchTickers(query: string, limit: number): Promise<TickerSuggestion[]> {
    // Search degrades to the curated local list rather than failing: an empty
    // autocomplete is a worse experience than a short one, and no number is
    // being asserted here.
    const local = await this.placeholder.searchTickers(query, Math.max(10, limit));
    if (!query.trim()) {
      return local.slice(0, limit);
    }
    try {
      const yahoo = await fetchYahooSuggestions(query, limit);
      return [...yahoo, ...local]
        .filter((item, idx, arr) => arr.findIndex((other) => other.symbol === item.symbol) === idx)
        .slice(0, limit);
    } catch {
      return local.slice(0, limit);
    }
  }

  async getQuote(symbol: string, fallbackCurrency?: string): Promise<QuoteSnapshot> {
    const failures: unknown[] = [];

    // `always` exists for tests and offline demos and must short-circuit the
    // network entirely, or the mode is a lie about what the process did.
    if (marketFallbackMode() === "always") {
      return this.placeholder.getQuote(symbol, fallbackCurrency);
    }

    for (const attempt of [
      () => this.yahoo.getQuote(symbol),
      () => this.finnhub.getQuote(symbol)
    ]) {
      try {
        const snapshot = await attempt();
        if (Number.isFinite(snapshot.price) && snapshot.price > 0) {
          return snapshot;
        }
        failures.push(new Error(`${snapshot.source}: non-positive price`));
      } catch (error) {
        failures.push(error);
      }
    }

    // Every live source is out. Whether a number gets invented here is a policy
    // decision, not a technical one — and in production the answer is no.
    if (!syntheticFallbackAllowed()) {
      throw new MarketDataUnavailableError(symbol.trim().toUpperCase(), failures[0]);
    }
    return this.placeholder.getQuote(symbol, fallbackCurrency);
  }
}

const provider = new HybridMarketProvider();

export function getMarketProvider(): MarketProvider {
  return provider;
}
