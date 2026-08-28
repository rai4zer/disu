/**
 * The market strip.
 *
 * This route used to build its own Yahoo URLs, parse its own payloads and pick
 * its own fallbacks — the one price surface in the app that did not go through
 * `MarketProvider` (ROADMAP §2.7). Upstream reads now live in
 * `app/lib/market/index-quotes.ts` behind the provider, and what is left here is
 * the part that is genuinely this route's job: how often to ask, what to keep
 * when the answer is partial, and how to render a reading as text.
 *
 * The synthetic-data rule lands differently for indices than for holdings. A
 * placeholder share price arrives labelled next to the holding it belongs to; a
 * placeholder index level would be an unlabelled claim about a whole market. So
 * there is no invented tail here at all — an index we cannot read renders "--",
 * enforced by the provider returning `null` rather than by this file
 * remembering not to fill it in.
 */

import { NextResponse } from "next/server";
import {
  getMarketProvider,
  INDEX_CATALOGUE,
  YahooRateLimitedError,
  type IndexReading
} from "@/app/lib/market/market-provider";
import { log } from "@/app/lib/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MarketItem = {
  label: string;
  fullName: string;
  price: string;
  value: string;
  time: string;
};

type IndicesPayload = {
  ok: true;
  items: MarketItem[];
  stale: boolean;
  asOf: string;
  source: string;
  reason?: string;
};

const UNKNOWN_ITEMS: MarketItem[] = INDEX_CATALOGUE.map((def) => ({
  label: def.label,
  fullName: def.fullName,
  price: "--",
  // "--", not "0.00%": we do not know the change, and an unchanged reading is a
  // claim about the market rather than an admission that we have no data.
  value: "--",
  time: "--:--"
}));

let lastKnownItems: MarketItem[] | null = null;
let lastKnownAsOf = "";

// Last good reading per index label. With nine indices a single refresh often
// gets some but not all of them (upstream rate limits), so we keep whatever we
// already had instead of blanking that index out to "--".
const lastReadingByLabel = new Map<string, IndexReading>();
// When the per-index chart fallback is in play, Yahoo only tolerates a couple of
// requests per window — so each refresh renews a slice of the strip and the rest
// keep their retained values. Never-fetched indices go first, then the stalest.
const lastChartAttemptByLabel = new Map<string, number>();
const CHART_REFRESH_BATCH = 3;

// Server-side cache so we don't hit Finnhub/Yahoo once per viewer per 60s poll,
// which is what trips Yahoo's rate limiter (HTTP 429). One upstream refresh per
// window is shared across all concurrent viewers.
const CACHE_TTL_MS = 45_000;
// After a failed upstream attempt, keep serving last-known values for this long
// before trying upstream again, so an outage/429 storm isn't amplified.
const FAILURE_COOLDOWN_MS = 20_000;
let cachedPayload: IndicesPayload | null = null;
let cachedAt = 0;
let lastFailureAt = 0;

const BATCH_TIMEOUT_MS = 6_000;
const CHART_TIMEOUT_MS = 12_000;
const CHART_PACING_MS = 800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickChartRefreshTargets(): number[] {
  const order = INDEX_CATALOGUE.map((def, index) => ({
    index,
    cold: !lastReadingByLabel.has(def.label),
    attemptedAt: lastChartAttemptByLabel.get(def.label) ?? 0
  }));
  order.sort((a, b) => {
    if (a.cold !== b.cold) return a.cold ? -1 : 1;
    if (a.attemptedAt !== b.attemptedAt) return a.attemptedAt - b.attemptedAt;
    return a.index - b.index;
  });
  return order.slice(0, CHART_REFRESH_BATCH).map((row) => row.index);
}

function mergeWithLastReadings(readings: Array<IndexReading | null>): Array<IndexReading | null> {
  return INDEX_CATALOGUE.map((def, index) => {
    const reading = readings[index];
    if (reading) {
      lastReadingByLabel.set(def.label, reading);
      return reading;
    }
    return lastReadingByLabel.get(def.label) ?? null;
  });
}

// Items built purely from retained per-index readings — always at least as
// complete as any earlier payload, since the retention map only ever gains rows.
function retainedItems(): MarketItem[] | null {
  const readings = INDEX_CATALOGUE.map((def) => lastReadingByLabel.get(def.label) ?? null);
  return readings.some(Boolean) ? toItems(readings) : null;
}

function formatChangePercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatTime(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    return "--:--";
  }
  return new Date(epochSeconds * 1000).toLocaleTimeString("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "--";
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function toItems(readings: Array<IndexReading | null>): MarketItem[] {
  return INDEX_CATALOGUE.map((def, index) => {
    const reading = readings[index];
    const changePct = Number(reading?.changePct);
    return {
      label: def.label,
      fullName: def.fullName,
      price: formatPrice(Number(reading?.price ?? 0)),
      // An index we could not read reports "--" rather than a flat 0.00%.
      value: reading && Number.isFinite(changePct) ? formatChangePercent(changePct) : "--",
      time: formatTime(Number(reading?.ts ?? 0))
    };
  });
}

function publish(readings: Array<IndexReading | null>, source: string): IndicesPayload {
  const merged = mergeWithLastReadings(readings);
  const items = toItems(merged);
  const asOf = new Date().toISOString();
  lastKnownItems = items;
  lastKnownAsOf = asOf;
  return { ok: true, items, stale: merged.some((row) => !row), asOf, source };
}

/**
 * The paced fallback: one Yahoo chart call per index, a slice of the strip per
 * refresh. Pacing is decided here rather than in the provider because it is a
 * property of how often *this* endpoint is polled, not of how Yahoo works.
 */
async function refreshChartSlice(signal: AbortSignal): Promise<Array<IndexReading | null>> {
  const provider = getMarketProvider();
  const readings: Array<IndexReading | null> = INDEX_CATALOGUE.map(() => null);

  for (const [position, index] of pickChartRefreshTargets().entries()) {
    if (position > 0) {
      await sleep(CHART_PACING_MS);
    }
    const def = INDEX_CATALOGUE[index];
    lastChartAttemptByLabel.set(def.label, Date.now());
    try {
      readings[index] = await provider.getIndexQuote(def, signal);
    } catch (error) {
      // A rate limit ends the slice: the remaining calls would only collect the
      // same 429 and deepen the penalty. Anything else is this index's problem,
      // so the next one still gets its turn.
      if (error instanceof YahooRateLimitedError) {
        break;
      }
    }
  }

  return readings;
}

async function computeIndices(): Promise<IndicesPayload> {
  const provider = getMarketProvider();
  try {
    const batchController = new AbortController();
    const batchTimeout = setTimeout(() => batchController.abort(), BATCH_TIMEOUT_MS);
    let batch;
    try {
      batch = await provider.getIndexQuotes(INDEX_CATALOGUE, batchController.signal);
    } finally {
      clearTimeout(batchTimeout);
    }

    if (batch.readings.some(Boolean)) {
      return publish(batch.readings, batch.source);
    }

    const chartController = new AbortController();
    const chartTimeout = setTimeout(() => chartController.abort(), CHART_TIMEOUT_MS);
    let chartReadings: Array<IndexReading | null>;
    try {
      chartReadings = await refreshChartSlice(chartController.signal);
    } finally {
      clearTimeout(chartTimeout);
    }

    if (chartReadings.some(Boolean)) {
      return publish(chartReadings, "yahoo-chart-fallback");
    }

    // Nothing fresh anywhere: serve retained per-index readings if we have any,
    // and "--" for the rest. No level is invented at any point on this path.
    log.warn("market.indices.fetch.failed", { reason: batch.reason });
    return {
      ok: true,
      items: retainedItems() ?? lastKnownItems ?? UNKNOWN_ITEMS,
      stale: true,
      asOf: lastKnownAsOf || new Date().toISOString(),
      source: "fallback",
      reason: batch.reason
    };
  } catch (error) {
    log.warn("market.indices.fetch.threw", {
      reason: error instanceof Error ? error.message : "unknown error"
    });
    return {
      ok: true,
      items: retainedItems() ?? lastKnownItems ?? UNKNOWN_ITEMS,
      stale: true,
      asOf: lastKnownAsOf || new Date().toISOString(),
      source: "fallback"
    };
  }
}

export async function GET() {
  const now = Date.now();

  // Serve a fresh cached payload without touching upstream.
  if (cachedPayload && now - cachedAt < CACHE_TTL_MS) {
    return NextResponse.json(cachedPayload);
  }

  // Inside the failure cooldown, keep serving last-known values (flagged stale)
  // instead of re-hammering an upstream that just failed / rate-limited us.
  if (cachedPayload && lastFailureAt && now - lastFailureAt < FAILURE_COOLDOWN_MS) {
    return NextResponse.json({
      ...cachedPayload,
      items: retainedItems() ?? cachedPayload.items,
      stale: true
    });
  }

  const payload = await computeIndices();

  if (payload.source !== "fallback") {
    // Got real upstream data — cache it and clear any failure cooldown.
    cachedPayload = payload;
    cachedAt = now;
    lastFailureAt = 0;
    return NextResponse.json(payload);
  }

  // Upstream failed. The payload already carries retained per-index readings,
  // which cover at least as much as the older cached payload did.
  lastFailureAt = now;
  return NextResponse.json(payload);
}
