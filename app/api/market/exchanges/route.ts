/**
 * The exchange map's readings: one index level per financial centre.
 *
 * Shaped exactly like `/api/market/board` and for the same reasons — 21
 * readings cost one upstream call because Yahoo's quote endpoint takes a
 * symbol list, a server-side cache means N viewers polling are not N upstream
 * calls, a failure cooldown stops a 429 storm being amplified, and per-entry
 * retention keeps a partial refresh from blanking the pins it already had
 * (docs/market-live-feed.md).
 *
 * Geography is not in the response. The catalogue with the coordinates is
 * imported by the map component directly, so a pin's position never depends on
 * a network call: an exchange with no reading is still a dot in the right
 * place, labelled "—". There is no placeholder Nikkei level
 * (docs/synthetic-data-policy.md, ROADMAP §2.1).
 */

import { NextResponse } from "next/server";
import { EXCHANGE_ENTRIES } from "@/app/lib/market/exchange-catalogue";
import { getMarketProvider, type IndexReading } from "@/app/lib/market/market-provider";
import { log } from "@/app/lib/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ExchangeQuote = {
  /** Exchange abbreviation, the catalogue's key into this payload. */
  code: string;
  /** Formatted index level, or null when we have no reading. Never a stand-in. */
  price: string | null;
  /** Day change in percent, or null. Never zero-as-unknown. */
  changePct: number | null;
  /** Feed timestamp, ISO, or null. */
  asOf: string | null;
};

type ExchangePayload = {
  ok: true;
  quotes: ExchangeQuote[];
  stale: boolean;
  asOf: string;
};

const CACHE_TTL_MS = 45_000;
const FAILURE_COOLDOWN_MS = 20_000;
const BATCH_TIMEOUT_MS = 8_000;

let cachedPayload: ExchangePayload | null = null;
let cachedAt = 0;
let lastFailureAt = 0;

/**
 * Last good reading per exchange code. A refresh that resolves Tokyo but not
 * London must not blank London — the reader would watch pins emptying and
 * refilling rather than a map that is simply a minute stale.
 */
const lastReadingByCode = new Map<string, IndexReading>();

function formatLevel(value: number, precision: number): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  });
}

function buildPayload(readings: Array<IndexReading | null>): ExchangePayload {
  const now = Date.now();
  let missing = 0;

  const quotes = EXCHANGE_ENTRIES.map((entry, index) => {
    const fresh = readings[index];
    if (fresh) {
      lastReadingByCode.set(entry.code, fresh);
    }
    const reading = lastReadingByCode.get(entry.code) ?? null;
    if (!reading) {
      missing += 1;
    }
    const changePct = Number(reading?.changePct);
    const ts = Number(reading?.ts);
    return {
      code: entry.code,
      price: reading ? formatLevel(Number(reading.price), entry.precision) : null,
      changePct: reading && Number.isFinite(changePct) ? changePct : null,
      asOf: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null
    };
  });

  return { ok: true, quotes, stale: missing > 0, asOf: new Date(now).toISOString() };
}

async function computeExchanges(): Promise<ExchangePayload> {
  const provider = getMarketProvider();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);

  try {
    const batch = await provider.getIndexQuotes(EXCHANGE_ENTRIES, controller.signal);
    if (!batch.readings.some(Boolean)) {
      log.warn("market.exchanges.fetch.empty", { reason: batch.reason });
    }
    return buildPayload(batch.readings);
  } catch (error) {
    log.warn("market.exchanges.fetch.threw", {
      reason: error instanceof Error ? error.message : "unknown error"
    });
    // Retained readings only: still emits whatever each pin last actually had.
    return buildPayload(EXCHANGE_ENTRIES.map(() => null));
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const now = Date.now();

  if (cachedPayload && now - cachedAt < CACHE_TTL_MS) {
    return NextResponse.json(cachedPayload);
  }

  if (cachedPayload && lastFailureAt && now - lastFailureAt < FAILURE_COOLDOWN_MS) {
    return NextResponse.json({ ...cachedPayload, stale: true });
  }

  const payload = await computeExchanges();

  // "Every pin missing" is the failure signal — it means the upstream leg
  // failed, not that no market on earth traded today.
  if (payload.quotes.some((quote) => quote.price !== null)) {
    cachedPayload = payload;
    cachedAt = now;
    lastFailureAt = 0;
  } else {
    lastFailureAt = now;
  }

  return NextResponse.json(payload);
}
