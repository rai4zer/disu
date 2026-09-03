/**
 * The shared quote cache: `market_quotes` (migration 0023) plus a per-process
 * memory tier in front of it.
 *
 * Two tiers, because they solve different problems. The memory tier removes a
 * database round-trip inside a request. The database tier is the one that
 * matters: it is shared across instances and survives a restart, which is what
 * ROADMAP §2.7 item 2.3 actually asks for — one fetch per symbol per interval
 * across all users, rather than per user. A per-process cache cannot do that.
 *
 * **This module never invents a reading.** A symbol it has nothing for is
 * absent from the returned map, and the caller renders "—". It has no
 * placeholder mode and does not consult `MARKET_MOCK_FALLBACK_MODE`, because
 * there is nothing here for that switch to permit — a cache that can fabricate
 * is strictly worse than no cache, since the fabrication then persists
 * (docs/synthetic-data-policy.md).
 *
 * **A missing table is a cold cache, not an error.** There is no migration
 * runner in this repo (ROADMAP queue 2.5), so 0023 is applied by hand and the
 * code necessarily runs before and after that moment. Every read here treats a
 * PostgREST "relation does not exist" as an empty result and every write drops
 * it, so the app degrades to live fetching instead of failing.
 */

import { supabaseRequest, SupabaseRequestError } from "../db/supabase.ts";
import { log } from "../observability/log.ts";
import type { BridgeQuote } from "./quote-bridge.ts";

export const MARKET_QUOTES_TABLE = "market_quotes";

/** A reading read back out of the cache, with the age the caller must judge. */
export type CachedQuote = {
  symbol: string;
  price: number;
  previousClose: number | null;
  currency: string | null;
  /** Feed timestamp: when the reading was taken upstream. */
  asOf: string | null;
  /** Our clock: when we observed it. Used for sweep scheduling, not display. */
  fetchedAt: string;
  source: "yfinance" | "finnhub";
};

type QuoteRow = {
  symbol?: unknown;
  price?: unknown;
  previous_close?: unknown;
  currency?: unknown;
  as_of?: unknown;
  fetched_at?: unknown;
  source?: unknown;
};

/**
 * Per-process tier. Small and unbounded on purpose: the key space is the set of
 * symbols this instance has been asked about, which is bounded in practice by
 * the board (24) plus held symbols, and every entry is a few dozen bytes.
 */
const memory = new Map<string, { quote: CachedQuote; storedAt: number }>();

const MEMORY_TTL_MS = 60_000;

/**
 * Whether a database error means "the migration has not run yet".
 *
 * PostgREST answers an unknown relation with 404 and Postgres code 42P01. Both
 * are checked because the message text is not a stable interface, and treating
 * a genuine outage as a cold cache would hide a real failure behind silent slow
 * paths.
 */
function isMissingTable(error: unknown): boolean {
  if (!(error instanceof SupabaseRequestError)) return false;
  return error.status === 404 || /42P01|does not exist/i.test(error.message);
}

/**
 * Whether the cache is simply not configured in this process.
 *
 * `getBaseUrl()` / `getApiKey()` throw a plain Error before any request is
 * made when the Supabase vars are absent. That is a *configuration* state, not
 * a runtime failure — the unit tests run in it, and so does any process
 * deliberately started without a database — so it must not warn. Left as a
 * warning it fired once per quote and buried real cache failures in noise,
 * which is the practical way a log stops being read.
 */
function isUnconfigured(error: unknown): boolean {
  return error instanceof Error && /Missing required env var/i.test(error.message);
}

function parseRow(row: QuoteRow): CachedQuote | null {
  const symbol = typeof row.symbol === "string" ? row.symbol.toUpperCase() : null;
  const price = typeof row.price === "number" && Number.isFinite(row.price) ? row.price : null;
  const fetchedAt = typeof row.fetched_at === "string" ? row.fetched_at : null;
  const source = row.source === "yfinance" || row.source === "finnhub" ? row.source : null;

  // A row failing any of these is a row this code did not write. Dropping it is
  // right: the alternative is rendering a number whose provenance we cannot
  // account for.
  if (!symbol || price === null || price <= 0 || !fetchedAt || !source) {
    return null;
  }

  const previousClose =
    typeof row.previous_close === "number" && Number.isFinite(row.previous_close) && row.previous_close > 0
      ? row.previous_close
      : null;

  return {
    symbol,
    price,
    previousClose,
    currency: typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency) ? row.currency : null,
    asOf: typeof row.as_of === "string" ? row.as_of : null,
    fetchedAt,
    source
  };
}

/**
 * Read what we already have for these symbols.
 *
 * `maxAgeMs` filters on `fetched_at` — how long ago *we* looked — rather than on
 * `as_of`, which is when the market last moved. Judging freshness on `as_of`
 * would treat every symbol as permanently stale over a weekend and refetch a
 * closed market on every sweep.
 */
export async function readCachedQuotes(symbols: string[], maxAgeMs: number): Promise<Map<string, CachedQuote>> {
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const found = new Map<string, CachedQuote>();
  if (wanted.length === 0) return found;

  const now = Date.now();
  const missing: string[] = [];

  for (const symbol of wanted) {
    const hit = memory.get(symbol);
    if (hit && now - hit.storedAt < MEMORY_TTL_MS && now - Date.parse(hit.quote.fetchedAt) < maxAgeMs) {
      found.set(symbol, hit.quote);
    } else {
      missing.push(symbol);
    }
  }

  if (missing.length === 0) return found;

  try {
    const rows = await supabaseRequest<QuoteRow[]>(MARKET_QUOTES_TABLE, {
      query: {
        select: "symbol,price,previous_close,currency,as_of,fetched_at,source",
        symbol: `in.(${missing.map((s) => `"${s}"`).join(",")})`
      }
    });

    for (const row of Array.isArray(rows) ? rows : []) {
      const quote = parseRow(row);
      if (!quote) continue;
      if (now - Date.parse(quote.fetchedAt) >= maxAgeMs) continue;
      found.set(quote.symbol, quote);
      memory.set(quote.symbol, { quote, storedAt: now });
    }
  } catch (error) {
    if (!isMissingTable(error) && !isUnconfigured(error)) {
      log.warn("market.cache.read.failed", {
        symbols: missing.length,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    // Either way the answer is the same: return what we have. A cache miss
    // costs a live fetch; it never costs correctness.
  }

  return found;
}

/**
 * Persist a batch of readings.
 *
 * Only priced readings are written. A `price: null` entry means "no source
 * could price this", and recording that would be recording an absence as a
 * fact — the table's `price not null` constraint refuses it at the database
 * level too, so this filter is the polite version of the same rule.
 */
export async function writeCachedQuotes(quotes: BridgeQuote[]): Promise<number> {
  const rows = quotes
    .filter((q) => q.price !== null && q.price > 0 && q.source !== "none")
    .map((q) => ({
      symbol: q.symbol.toUpperCase(),
      price: q.price,
      previous_close: q.previousClose,
      currency: q.currency,
      as_of: q.asOf,
      fetched_at: new Date().toISOString(),
      source: q.source
    }));

  if (rows.length === 0) return 0;

  try {
    await supabaseRequest(MARKET_QUOTES_TABLE, {
      method: "POST",
      body: rows,
      // Upsert on the primary key: one row per symbol, always the newest
      // reading. History is not kept here — `portfolio_snapshots` is the table
      // that records what a thing was worth on a past day, and duplicating that
      // job badly would produce a second, contradictory history.
      prefer: "resolution=merge-duplicates,return=minimal"
    });
  } catch (error) {
    if (isMissingTable(error) || isUnconfigured(error)) {
      log.info("market.cache.write.skipped", {
        reason: isMissingTable(error) ? "market_quotes not migrated yet" : "supabase not configured",
        rows: rows.length
      });
      return 0;
    }
    log.warn("market.cache.write.failed", {
      rows: rows.length,
      error: error instanceof Error ? error.message : String(error)
    });
    return 0;
  }

  const now = Date.now();
  for (const row of rows) {
    const quote = parseRow(row as QuoteRow);
    if (quote) memory.set(quote.symbol, { quote, storedAt: now });
  }

  return rows.length;
}

/** Test seam. The memory tier is module state, so a test must be able to clear it. */
export function resetQuoteMemoryCache(): void {
  memory.clear();
}
