/**
 * Read-through cache for instrument detail (migration 0024).
 *
 * The access pattern differs from `quote-cache.ts` in the way that matters: a
 * quote is swept in advance, an instrument profile cannot be. So this is
 * read-through — a miss fetches, and the fetch is single-flighted per symbol so
 * ten people opening the same page at once start one interpreter rather than
 * ten.
 *
 * The TTL is one hour, chosen for the fastest-moving section rather than the
 * slowest. Financials change quarterly and analyst estimates weekly, but news
 * is on the same payload and an hour-old headline list is the limit of what can
 * be called a feed. The cost of that choice is re-fetching slow data hourly;
 * the alternative is splitting the payload, which is a refinement rather than a
 * v1.
 *
 * A missing table is a cold cache, not an error: 0024 is applied by hand.
 */

import { supabaseRequest, SupabaseRequestError } from "../db/supabase.ts";
import { log } from "../observability/log.ts";
import {
  fetchInstrumentViaBridge,
  normaliseSymbol,
  type InstrumentDetail,
  type InstrumentSections
} from "./instrument-bridge.ts";

export const INSTRUMENT_PROFILES_TABLE = "instrument_profiles";

const TTL_MS = 60 * 60 * 1000;

export type CachedInstrument = {
  detail: InstrumentDetail;
  fetchedAt: string;
  /** True when this came from storage rather than a fresh spawn. */
  cached: boolean;
};

type ProfileRow = {
  symbol?: unknown;
  payload?: unknown;
  sections?: unknown;
  fetched_at?: unknown;
};

/**
 * In-flight fetches, keyed by symbol.
 *
 * Without this, a page that fans out to several viewers at once — or a single
 * viewer whose browser retries — starts one Python interpreter per request.
 * Each costs ~3s and a few hundred MB, so the pile-up is the difference between
 * a slow page and an unresponsive host.
 */
const inFlight = new Map<string, Promise<InstrumentDetail>>();

function isMissingTable(error: unknown): boolean {
  if (!(error instanceof SupabaseRequestError)) return false;
  return error.status === 404 || /42P01|does not exist/i.test(error.message);
}

function isUnconfigured(error: unknown): boolean {
  return error instanceof Error && /Missing required env var/i.test(error.message);
}

function quiet(error: unknown): boolean {
  return isMissingTable(error) || isUnconfigured(error);
}

async function readRow(symbol: string): Promise<CachedInstrument | null> {
  try {
    const rows = await supabaseRequest<ProfileRow[]>(INSTRUMENT_PROFILES_TABLE, {
      query: { select: "symbol,payload,sections,fetched_at", symbol: `eq.${symbol}`, limit: "1" }
    });
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) return null;

    const fetchedAt = typeof row.fetched_at === "string" ? row.fetched_at : null;
    const payload = row.payload;
    if (!fetchedAt || !payload || typeof payload !== "object") return null;
    if (Date.now() - Date.parse(fetchedAt) >= TTL_MS) return null;

    // The payload was validated by instrument-bridge's parser before it was
    // written, so it is re-used as-is rather than re-parsed. A row that fails
    // this shape check is one this code did not write, and is treated as a miss
    // rather than rendered.
    const detail = payload as InstrumentDetail;
    if (!detail.profile || !detail.sections) return null;

    return { detail, fetchedAt, cached: true };
  } catch (error) {
    if (!quiet(error)) {
      log.warn("market.instrument.cache.read.failed", {
        symbol,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return null;
  }
}

async function writeRow(detail: InstrumentDetail): Promise<void> {
  try {
    await supabaseRequest(INSTRUMENT_PROFILES_TABLE, {
      method: "POST",
      body: [
        {
          symbol: detail.symbol,
          payload: detail,
          quote_type: detail.profile.quoteType,
          sections: detail.sections,
          fetched_at: new Date().toISOString()
        }
      ],
      prefer: "resolution=merge-duplicates,return=minimal"
    });
  } catch (error) {
    if (quiet(error)) {
      log.info("market.instrument.cache.write.skipped", {
        symbol: detail.symbol,
        reason: isMissingTable(error) ? "instrument_profiles not migrated yet" : "supabase not configured"
      });
      return;
    }
    log.warn("market.instrument.cache.write.failed", {
      symbol: detail.symbol,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Instrument detail for one symbol, from cache when it is fresh enough.
 *
 * Throws when the symbol cannot be resolved at all. That is deliberate: the
 * caller turns it into a 404, which is the honest answer for a page about an
 * instrument nobody has data for.
 */
export async function getInstrumentDetail(rawSymbol: string): Promise<CachedInstrument> {
  const symbol = normaliseSymbol(rawSymbol);
  if (!symbol) {
    throw new Error(`Malformed symbol: ${rawSymbol.slice(0, 32)}`);
  }

  const hit = await readRow(symbol);
  if (hit) return hit;

  const existing = inFlight.get(symbol);
  if (existing) {
    return { detail: await existing, fetchedAt: new Date().toISOString(), cached: false };
  }

  const pending = fetchInstrumentViaBridge(symbol).finally(() => {
    inFlight.delete(symbol);
  });
  inFlight.set(symbol, pending);

  const detail = await pending;
  // Not awaited: the reader has what they came for, and a slow cache write must
  // not hold up the response. Failures are logged inside writeRow.
  void writeRow(detail);

  return { detail, fetchedAt: new Date().toISOString(), cached: false };
}

/** Which tabs a symbol supports, without loading the whole payload. */
export function tabsFor(sections: InstrumentSections): Array<keyof InstrumentSections> {
  return (["overview", "kpi", "news", "analysts"] as const).filter((tab) => sections[tab]);
}

/** Test seam: the single-flight map is module state. */
export function resetInstrumentCacheForTests(): void {
  inFlight.clear();
}
