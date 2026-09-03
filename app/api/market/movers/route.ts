/**
 * Gainers and losers, over a named universe.
 *
 * The honest framing matters more than the code here. Neither provider on the
 * current plan exposes a market-wide screener, so this route cannot answer
 * "today's biggest gainers on the Stockholm exchange" — and answering it anyway
 * from a sample would be a claim about a market nobody measured.
 *
 * What it answers instead is a question it can actually observe: *of these 24
 * named large caps, which moved most today.* The universe is fixed and declared
 * in `board-catalogue.ts`, the count travels in the payload, and the cards say
 * "of 24 tracked names" on their face. Same data, a true sentence over it.
 *
 * Replacing this with a real screener is a provider decision, not a code
 * decision — it lands with the licensed feed in ROADMAP §2.7 / D2.
 *
 * A name we could not price is dropped from the ranking rather than ranked at
 * zero: an unread quote is not a flat day (docs/synthetic-data-policy.md).
 */

import { NextResponse } from "next/server";
import { MOVERS_UNIVERSE } from "@/app/lib/market/board-catalogue";
import { getMarketProvider, type IndexDescriptor } from "@/app/lib/market/market-provider";
import { log } from "@/app/lib/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type Mover = {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
};

type MoversPayload = {
  ok: true;
  gainers: Mover[];
  losers: Mover[];
  /** How many of the universe we actually priced — the card prints this. */
  covered: number;
  universeSize: number;
  asOf: string;
};

const CACHE_TTL_MS = 60_000;
const FAILURE_COOLDOWN_MS = 30_000;
const BATCH_TIMEOUT_MS = 8_000;
const LIST_SIZE = 5;

let cachedPayload: MoversPayload | null = null;
let cachedAt = 0;
let lastFailureAt = 0;

/**
 * The universe as index descriptors, so the ranking rides the same batched
 * Yahoo quote call as everything else rather than opening 24 of its own.
 * Finnhub cannot batch, so its matchers are empty and it simply does not
 * contribute here — a miss degrades to a shorter list, never to a made-up one.
 */
const DESCRIPTORS: IndexDescriptor[] = MOVERS_UNIVERSE.map((row) => ({
  label: row.symbol,
  fullName: row.name,
  yahooSymbols: [row.symbol],
  finnhubSymbols: [],
  finnhubMatchers: []
}));

async function computeMovers(): Promise<MoversPayload> {
  const provider = getMarketProvider();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);

  try {
    const batch = await provider.getIndexQuotes(DESCRIPTORS, controller.signal);

    const priced: Mover[] = [];
    batch.readings.forEach((reading, index) => {
      if (!reading) return;
      const changePct = Number(reading.changePct);
      const price = Number(reading.price);
      // Both must be real. A name with a level but no change cannot be ranked,
      // and ranking it as 0% would put an unknown in the middle of a list whose
      // whole meaning is ordering by that number.
      if (!Number.isFinite(changePct) || !Number.isFinite(price) || price <= 0) return;
      priced.push({
        symbol: MOVERS_UNIVERSE[index].symbol,
        name: MOVERS_UNIVERSE[index].name,
        price,
        changePct
      });
    });

    if (priced.length === 0) {
      log.warn("market.movers.fetch.empty", { reason: batch.reason });
    }

    const ranked = priced.slice().sort((a, b) => b.changePct - a.changePct);

    return {
      ok: true,
      // Only actual risers rise and only actual fallers fall: in a red market
      // the fifth-best name is still down, and listing it under "gainers"
      // would be a green label on a loss.
      gainers: ranked.filter((row) => row.changePct > 0).slice(0, LIST_SIZE),
      losers: ranked
        .filter((row) => row.changePct < 0)
        .slice(-LIST_SIZE)
        .reverse(),
      covered: priced.length,
      universeSize: MOVERS_UNIVERSE.length,
      asOf: new Date().toISOString()
    };
  } catch (error) {
    log.warn("market.movers.fetch.threw", {
      reason: error instanceof Error ? error.message : "unknown error"
    });
    return {
      ok: true,
      gainers: [],
      losers: [],
      covered: 0,
      universeSize: MOVERS_UNIVERSE.length,
      asOf: new Date().toISOString()
    };
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
    return NextResponse.json(cachedPayload);
  }

  const payload = await computeMovers();

  if (payload.covered > 0) {
    cachedPayload = payload;
    cachedAt = now;
    lastFailureAt = 0;
    return NextResponse.json(payload);
  }

  lastFailureAt = now;
  // Nothing priced this round. An older ranking is still a real observation
  // from a known time, which beats an empty card.
  return NextResponse.json(cachedPayload ?? payload);
}
