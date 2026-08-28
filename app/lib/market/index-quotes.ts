/**
 * Index quotes: the catalogue and the upstream reads behind it.
 *
 * These used to live inside `app/api/market/indices/route.ts`, which built its
 * own Yahoo URLs, parsed its own payloads and decided its own fallbacks — the
 * one price surface in the app that was not behind `MarketProvider` (ROADMAP
 * §2.7). The consequence was not theoretical: `MARKET_MOCK_FALLBACK_MODE` is
 * the switch that stops production inventing prices, and it could not reach the
 * market strip because the strip did not go through the provider.
 *
 * Index quotes are genuinely not `getQuote(symbol)`:
 *
 *   - **Resolution is a catalogue problem.** "OMXS30" is `^OMX` to Yahoo and
 *     something discovered from `/index/list` to Finnhub. A ticker is a ticker;
 *     an index is a name you have to look up.
 *   - **Reads must be batched.** Nine indices through `getQuote()` would be nine
 *     upstream calls per refresh, and Yahoo's rate limiter is the documented
 *     failure mode (docs/market-live-feed.md). The interface is therefore
 *     batch-shaped by construction.
 *   - **There is no honest placeholder.** A made-up share price is at least
 *     labelled synthetic next to the holding it belongs to. A made-up index
 *     level is a claim about the whole market with nowhere to put the caveat,
 *     so this module never invents one — a missing index is `null`, and the
 *     strip renders "--". That is the policy, expressed as a return type rather
 *     than as a literal somebody has to remember not to change.
 *
 * This module is pure upstream I/O and parsing. Which source is tried in which
 * order, and whether a placeholder is permitted at all, is the provider's job in
 * `market-provider.ts`.
 */

import { finnhubFetch } from "./finnhub-client";

export type IndexDescriptor = {
  label: string;
  fullName: string;
  /** Yahoo symbols in priority order (first one that resolves wins). */
  yahooSymbols: string[];
  /** Finnhub symbol guesses, tried after the index-list lookup. */
  finnhubSymbols: string[];
  /** Matched against Finnhub's index list (normalized description/symbol). */
  finnhubMatchers: Array<(normalized: string) => boolean>;
};

/**
 * One observed index level.
 *
 * There is deliberately no `synthetic` flag, unlike `QuoteSnapshot`: an
 * `IndexReading` that exists was observed. The unobserved case is `null`.
 */
export type IndexReading = {
  price: number;
  changePct: number;
  /** Unix seconds, from the feed — not the time we fetched it. */
  ts: number;
};

/** The strip renders these in order. */
export const INDEX_CATALOGUE: IndexDescriptor[] = [
  {
    label: "S&P 500",
    fullName: "S&P 500",
    yahooSymbols: ["^GSPC"],
    finnhubSymbols: ["^GSPC", "GSPC", "SPX"],
    finnhubMatchers: [(v) => v.includes("s p 500"), (v) => v.includes("gspc")]
  },
  {
    label: "Nasdaq",
    fullName: "Nasdaq Composite",
    yahooSymbols: ["^IXIC"],
    finnhubSymbols: ["^IXIC", "IXIC", "NASDAQ"],
    finnhubMatchers: [(v) => v.includes("nasdaq composite"), (v) => v.includes("ixic")]
  },
  {
    label: "Dow Jones",
    fullName: "Dow Jones Industrial Average (DJI)",
    yahooSymbols: ["^DJI"],
    finnhubSymbols: ["^DJI", "DJI"],
    finnhubMatchers: [
      (v) => v.includes("dow jones industrial average"),
      (v) => v.includes("dow jones industrial")
    ]
  },
  {
    label: "OMXS30",
    fullName: "OMX Stockholm 30 (OMXS30)",
    yahooSymbols: ["^OMX", "^OMXS30"],
    finnhubSymbols: ["OMXS30", "OMX", "^OMX", "^OMXS30"],
    finnhubMatchers: [
      (v) => v.includes("omx stockholm 30"),
      (v) => v.includes("omxs30"),
      (v) => v.includes("stockholm 30")
    ]
  },
  {
    label: "Nikkei 225",
    fullName: "Nikkei 225",
    yahooSymbols: ["^N225"],
    finnhubSymbols: ["^N225", "N225", "NI225"],
    finnhubMatchers: [(v) => v.includes("nikkei 225"), (v) => v.includes("n225")]
  },
  {
    label: "FTSE 100",
    fullName: "FTSE 100",
    yahooSymbols: ["^FTSE"],
    finnhubSymbols: ["^FTSE", "FTSE", "UKX"],
    finnhubMatchers: [(v) => v.includes("ftse 100"), (v) => v.includes("ftse")]
  },
  {
    label: "DAX",
    fullName: "DAX (Germany 40)",
    yahooSymbols: ["^GDAXI"],
    finnhubSymbols: ["^GDAXI", "GDAXI", "DAX"],
    finnhubMatchers: [(v) => v.includes("dax"), (v) => v.includes("gdaxi")]
  },
  {
    label: "SSEC",
    fullName: "Shanghai SE Composite (SSEC)",
    yahooSymbols: ["000001.SS"],
    finnhubSymbols: ["000001.SS", "SHCOMP", "^SSEC"],
    finnhubMatchers: [
      (v) => v.includes("shanghai composite"),
      (v) => v.includes("sse composite"),
      (v) => v.includes("shanghai se composite")
    ]
  },
  {
    label: "Hang Seng",
    fullName: "Hang Seng Index (HSI)",
    yahooSymbols: ["^HSI"],
    finnhubSymbols: ["^HSI", "HSI"],
    finnhubMatchers: [(v) => v.includes("hang seng"), (v) => v.includes("hsi")]
  }
];

type YahooHost = "query1.finance.yahoo.com" | "query2.finance.yahoo.com";

const YAHOO_HOSTS: readonly YahooHost[] = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

// Yahoo's endpoints are unofficial and answer a bare fetch with 401/429. The
// browser-shaped headers are not evasion of a paywall — there is no paid tier
// being avoided — they are what the public endpoint expects.
const YAHOO_HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9"
} as const;

/** Signals that Yahoo rate-limited us, so the caller stops rather than retries. */
export class YahooRateLimitedError extends Error {
  constructor(source: string) {
    super(`${source}: HTTP 429`);
    this.name = "YahooRateLimitedError";
  }
}

export type BatchOutcome = {
  readings: Array<IndexReading | null>;
  /** Empty when the phase produced everything it was asked for. */
  reason: string;
};

// --- Yahoo: one batched quote call for the whole strip ----------------------

type YahooQuoteRow = {
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  regularMarketTime?: number;
};

/**
 * The cheap path: every index in a single request. Yahoo answers this one with
 * 401 often enough that the chart fallback below exists, but when it works it
 * costs one call for nine indices.
 */
export async function fetchYahooIndexBatch(
  indices: IndexDescriptor[],
  signal: AbortSignal
): Promise<BatchOutcome> {
  const symbols = encodeURIComponent(indices.flatMap((def) => def.yahooSymbols).join(","));
  let reason = "";

  for (const host of YAHOO_HOSTS) {
    let response: Response;
    try {
      response = await fetch(`https://${host}/v7/finance/quote?symbols=${symbols}`, {
        headers: YAHOO_HEADERS,
        cache: "no-store",
        signal
      });
    } catch (error) {
      reason = error instanceof Error ? `${host}: ${error.message}` : `${host}: unknown error`;
      continue;
    }
    if (!response.ok) {
      reason = `${host}: HTTP ${response.status}`;
      continue;
    }

    const payload = (await response.json()) as { quoteResponse?: { result?: YahooQuoteRow[] } };
    const bySymbol = new Map((payload.quoteResponse?.result ?? []).map((row) => [row.symbol ?? "", row]));
    const readings = indices.map((def) => {
      for (const symbol of def.yahooSymbols) {
        const row = bySymbol.get(symbol);
        if (row && Number.isFinite(Number(row.regularMarketChangePercent))) {
          return {
            price: Number(row.regularMarketPrice ?? 0),
            changePct: Number(row.regularMarketChangePercent ?? 0),
            ts: Number(row.regularMarketTime ?? 0)
          };
        }
      }
      return null;
    });

    if (readings.some(Boolean)) {
      return { readings, reason: "" };
    }
    // Responded, but with nothing usable. The chart endpoint is the next try.
    reason = `${host}: quote response had no usable index rows`;
  }

  return { readings: indices.map(() => null), reason };
}

// --- Yahoo: one chart call for one index ------------------------------------

/**
 * The per-index fallback, often available when the batch endpoint returns 401.
 *
 * One index per call, so the *caller* decides how many to attempt per refresh —
 * this function does not pace itself. Throws `YahooRateLimitedError` so a 429
 * stops the whole phase instead of being retried across hosts and symbols.
 */
export async function fetchYahooIndexChart(
  index: IndexDescriptor,
  signal: AbortSignal
): Promise<IndexReading | null> {
  for (const symbol of index.yahooSymbols) {
    for (const host of YAHOO_HOSTS) {
      try {
        const response = await fetch(
          `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`,
          { headers: YAHOO_HEADERS, cache: "no-store", signal }
        );
        if (!response.ok) {
          if (response.status === 429) {
            throw new YahooRateLimitedError(`${host} chart ${symbol}`);
          }
          continue;
        }
        const payload = (await response.json()) as {
          chart?: {
            result?: Array<{
              meta?: {
                regularMarketPrice?: number;
                chartPreviousClose?: number;
                previousClose?: number;
                regularMarketTime?: number;
              };
            }>;
          };
        };
        const meta = payload.chart?.result?.[0]?.meta;
        const price = Number(meta?.regularMarketPrice ?? 0);
        const previous = Number(meta?.previousClose ?? meta?.chartPreviousClose ?? 0);
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(previous) || previous <= 0) {
          continue;
        }
        return {
          price,
          changePct: ((price - previous) / previous) * 100,
          ts: Number(meta?.regularMarketTime ?? 0)
        };
      } catch (error) {
        if (error instanceof YahooRateLimitedError) {
          throw error;
        }
        // Any other failure is this host/symbol pair's problem — try the next.
      }
    }
  }
  return null;
}

// --- Finnhub: catalogue lookup, then daily candles --------------------------

type FinnhubIndexRow = {
  symbol?: string;
  displaySymbol?: string;
  description?: string;
};

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function fetchFinnhubIndexList(signal: AbortSignal): Promise<FinnhubIndexRow[]> {
  const payload = await finnhubFetch<unknown>("/index/list", "finnhub index list", signal);
  if (!Array.isArray(payload)) {
    throw new Error("finnhub index list: invalid payload");
  }
  return payload as FinnhubIndexRow[];
}

export function resolveFinnhubIndexSymbol(
  rows: FinnhubIndexRow[],
  matchers: Array<(normalized: string) => boolean>
): string | null {
  for (const row of rows) {
    const description = normalizeLabel(row.description ?? "");
    const displaySymbol = normalizeLabel(row.displaySymbol ?? "");
    const symbol = normalizeLabel(row.symbol ?? "");
    for (const matcher of matchers) {
      if (matcher(description) || matcher(displaySymbol) || matcher(symbol)) {
        return row.symbol ?? row.displaySymbol ?? null;
      }
    }
  }
  return null;
}

/**
 * Finnhub has no index *quote* on this plan, so the level comes from the last
 * two daily closes. That makes it end-of-day data: correct, but a day behind
 * intraday, which is why it sits behind Yahoo in the chain rather than in front.
 */
export async function fetchFinnhubIndexCandle(symbol: string, signal: AbortSignal): Promise<IndexReading> {
  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = nowSec - 7 * 24 * 60 * 60;
  const payload = await finnhubFetch<{ c?: unknown; t?: unknown; s?: unknown }>(
    `/index/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${fromSec}&to=${nowSec}`,
    `finnhub candle ${symbol}`,
    signal
  );
  if (payload.s !== "ok" || !Array.isArray(payload.c) || !Array.isArray(payload.t) || payload.c.length < 2) {
    throw new Error(`finnhub candle ${symbol}: no data`);
  }
  const closes = payload.c.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
  const times = payload.t.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
  if (closes.length < 2 || times.length < 1) {
    throw new Error(`finnhub candle ${symbol}: invalid series`);
  }
  const latest = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  return {
    price: latest,
    changePct: ((latest - prev) / prev) * 100,
    ts: times[times.length - 1]
  };
}
