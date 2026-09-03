/**
 * The dashboard market board: markets, commodities, crypto and FX in one call.
 *
 * One route for four cards rather than four routes, because all four are the
 * same upstream request. Yahoo's quote endpoint takes a comma-separated symbol
 * list, so 24 readings cost one call — splitting them across four endpoints
 * would cost four, and Yahoo's rate limiter is the documented failure mode here
 * (docs/market-live-feed.md).
 *
 * Caching and retention follow `/api/market/indices`, for the same reasons: a
 * server-side cache so N viewers polling do not become N upstream calls, a
 * failure cooldown so a 429 storm is not amplified, and per-entry retention so
 * a partial refresh keeps the readings it already had instead of blanking them.
 *
 * What this route will never do is fill a gap. An entry with no reading is
 * `null` all the way to the card, which renders "—". There is no placeholder
 * gold price (docs/synthetic-data-policy.md, ROADMAP §2.1).
 */

import { NextResponse } from "next/server";
import { BOARD_GROUPS, type BoardEntry, type BoardGroupKey } from "@/app/lib/market/board-catalogue";
import { getMarketProvider, type IndexReading } from "@/app/lib/market/market-provider";
import { log } from "@/app/lib/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type BoardTile = {
  label: string;
  fullName: string;
  unit: string | null;
  /** Formatted level, or null when we have no reading. Never a stand-in. */
  price: string | null;
  /** Day change in percent, or null. Never zero-as-unknown. */
  changePct: number | null;
  /** Feed timestamp, ISO, or null. */
  asOf: string | null;
};

type BoardPayload = {
  ok: true;
  groups: Record<BoardGroupKey, BoardTile[]>;
  stale: boolean;
  asOf: string;
};

const CACHE_TTL_MS = 45_000;
const FAILURE_COOLDOWN_MS = 20_000;
const BATCH_TIMEOUT_MS = 8_000;

let cachedPayload: BoardPayload | null = null;
let cachedAt = 0;
let lastFailureAt = 0;

/**
 * Last good reading per entry label. A refresh that resolves eight of 24
 * symbols must not blank the other sixteen — the reader would see a card
 * emptying and refilling rather than a card that is simply a minute stale.
 */
const lastReadingByLabel = new Map<string, { reading: IndexReading; at: number }>();

/** Every entry across every group, in one flat list for one upstream call. */
const ALL_ENTRIES: Array<{ group: BoardGroupKey; entry: BoardEntry }> = (
  Object.keys(BOARD_GROUPS) as BoardGroupKey[]
).flatMap((group) => BOARD_GROUPS[group].map((entry) => ({ group, entry })));

function formatLevel(value: number, precision: number): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  });
}

function toTile(entry: BoardEntry, reading: IndexReading | null): BoardTile {
  const changePct = Number(reading?.changePct);
  const ts = Number(reading?.ts);
  return {
    label: entry.label,
    fullName: entry.fullName,
    unit: entry.unit ?? null,
    price: reading ? formatLevel(Number(reading.price), entry.precision) : null,
    changePct: reading && Number.isFinite(changePct) ? changePct : null,
    asOf: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null
  };
}

function buildPayload(readings: Array<IndexReading | null>): BoardPayload {
  const now = Date.now();
  const groups: Record<BoardGroupKey, BoardTile[]> = {
    markets: [],
    commodities: [],
    crypto: [],
    fx: []
  };

  let missing = 0;

  ALL_ENTRIES.forEach(({ group, entry }, index) => {
    const fresh = readings[index];
    if (fresh) {
      lastReadingByLabel.set(entry.label, { reading: fresh, at: now });
    }
    const retained = lastReadingByLabel.get(entry.label)?.reading ?? null;
    if (!retained) {
      missing += 1;
    }
    groups[group].push(toTile(entry, retained));
  });

  return {
    ok: true,
    groups,
    stale: missing > 0,
    asOf: new Date(now).toISOString()
  };
}

async function computeBoard(): Promise<BoardPayload> {
  const provider = getMarketProvider();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);

  try {
    const batch = await provider.getIndexQuotes(
      ALL_ENTRIES.map(({ entry }) => entry),
      controller.signal
    );
    if (!batch.readings.some(Boolean)) {
      log.warn("market.board.fetch.empty", { reason: batch.reason });
    }
    return buildPayload(batch.readings);
  } catch (error) {
    log.warn("market.board.fetch.threw", {
      reason: error instanceof Error ? error.message : "unknown error"
    });
    // Retained readings only — `buildPayload` with nothing fresh still emits
    // whatever each entry last actually had, and null for the rest.
    return buildPayload(ALL_ENTRIES.map(() => null));
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

  const payload = await computeBoard();

  // "Everything missing" is the failure signal — a board where no entry
  // resolved means the upstream leg failed, not that the world has no prices.
  const anyResolved = (Object.keys(payload.groups) as BoardGroupKey[]).some((group) =>
    payload.groups[group].some((tile) => tile.price !== null)
  );

  if (anyResolved) {
    cachedPayload = payload;
    cachedAt = now;
    lastFailureAt = 0;
  } else {
    lastFailureAt = now;
  }

  return NextResponse.json(payload);
}
