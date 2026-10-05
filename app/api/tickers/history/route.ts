import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 8000;

const CACHE_HEADERS = { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" };

// Yahoo rejects mismatched range/interval pairs, so each range owns its granularity:
// intraday ranges get minute bars, multi-year ranges get weekly/monthly ones.
const RANGES = {
  "1d": { interval: "5m", intraday: true },
  "5d": { interval: "30m", intraday: true },
  "1mo": { interval: "1d", intraday: false },
  "6mo": { interval: "1d", intraday: false },
  ytd: { interval: "1d", intraday: false },
  "1y": { interval: "1d", intraday: false },
  "5y": { interval: "1wk", intraday: false },
  max: { interval: "1mo", intraday: false }
} as const;

export type HistoryRange = keyof typeof RANGES;

export type HistoryCandle = {
  t: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

export type HistoryMeta = {
  symbol: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  timezone: string | null;
  price: number | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  volume: number | null;
};

function num(value: unknown): number | null {
  // Number(null) is 0, and Yahoo pads gaps with nulls — coercing them would
  // plot a zero close for a session that never traded.
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

// Price history is the same for every viewer, and the upstream round trip is
// the whole cost of the request. Holding parsed responses in memory for as long
// as they stay true (a minute for intraday bars, five for daily ones) means the
// second person to open a symbol — and the same person switching back to a
// range — is served without touching Yahoo. Per-instance and deliberately
// bounded; this is a latency cache, not a store.
type CachedHistory = { body: Record<string, unknown>; at: number };

const HISTORY_CACHE = new Map<string, CachedHistory>();
const HISTORY_CACHE_MAX = 400;
const INTRADAY_TTL_MS = 60_000;
const DAILY_TTL_MS = 5 * 60_000;

function readCache(key: string, intraday: boolean): Record<string, unknown> | null {
  const hit = HISTORY_CACHE.get(key);
  if (!hit) {
    return null;
  }
  if (Date.now() - hit.at > (intraday ? INTRADAY_TTL_MS : DAILY_TTL_MS)) {
    HISTORY_CACHE.delete(key);
    return null;
  }
  // Re-inserting keeps the most recently read keys at the tail, so the eviction
  // below drops the coldest entry rather than the oldest one.
  HISTORY_CACHE.delete(key);
  HISTORY_CACHE.set(key, hit);
  return hit.body;
}

function writeCache(key: string, body: Record<string, unknown>): void {
  HISTORY_CACHE.set(key, { body, at: Date.now() });
  while (HISTORY_CACHE.size > HISTORY_CACHE_MAX) {
    const coldest = HISTORY_CACHE.keys().next();
    if (coldest.done) {
      break;
    }
    HISTORY_CACHE.delete(coldest.value);
  }
}

async function fetchChart(symbol: string, range: string, interval: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${range}&interval=${interval}&includePrePost=false`;

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "FinanceAutomation/1.0" },
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`Upstream responded ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const symbol = (request.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-^=]{1,16}$/.test(symbol)) {
    return NextResponse.json({ ok: false, error: "Invalid symbol" }, { status: 400 });
  }

  const requested = (request.nextUrl.searchParams.get("range") ?? "6mo").trim().toLowerCase();
  const range = (Object.keys(RANGES) as HistoryRange[]).includes(requested as HistoryRange)
    ? (requested as HistoryRange)
    : "6mo";
  const { interval, intraday } = RANGES[range];

  const cacheKey = `${symbol}|${range}`;
  const cached = readCache(cacheKey, intraday);
  if (cached) {
    return NextResponse.json(cached, { headers: CACHE_HEADERS });
  }

  let json: unknown;
  try {
    json = await fetchChart(symbol, range, interval);
  } catch {
    return NextResponse.json({ ok: false, error: "History unavailable" }, { status: 502 });
  }

  const result = (
    json as {
      chart?: {
        result?: Array<{
          meta?: Record<string, unknown>;
          timestamp?: unknown[];
          indicators?: {
            quote?: Array<Record<string, unknown[]>>;
            adjclose?: Array<{ adjclose?: unknown[] }>;
          };
        }>;
      };
    }
  ).chart?.result?.[0];

  const timestamps = Array.isArray(result?.timestamp) ? result!.timestamp : [];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const closes = Array.isArray(quote.close) ? quote.close : [];

  const candles: HistoryCandle[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const close = num(closes[index]);
    const t = num(timestamps[index]);
    // Yahoo pads closed sessions with nulls; a bar without a close is not a bar.
    if (close === null || t === null) {
      continue;
    }
    candles.push({
      t: t * 1000,
      open: num(Array.isArray(quote.open) ? quote.open[index] : null) ?? close,
      high: num(Array.isArray(quote.high) ? quote.high[index] : null) ?? close,
      low: num(Array.isArray(quote.low) ? quote.low[index] : null) ?? close,
      close,
      volume: num(Array.isArray(quote.volume) ? quote.volume[index] : null)
    });
  }

  if (candles.length === 0) {
    return NextResponse.json({ ok: false, error: "No history for symbol" }, { status: 404 });
  }

  const rawMeta = result?.meta ?? {};
  const meta: HistoryMeta = {
    symbol: str(rawMeta.symbol) ?? symbol,
    name: str(rawMeta.longName) ?? str(rawMeta.shortName),
    currency: str(rawMeta.currency)?.toUpperCase() ?? null,
    exchange: str(rawMeta.fullExchangeName) ?? str(rawMeta.exchangeName),
    timezone: str(rawMeta.exchangeTimezoneName),
    price: num(rawMeta.regularMarketPrice) ?? candles[candles.length - 1].close,
    previousClose: num(rawMeta.chartPreviousClose) ?? num(rawMeta.previousClose),
    dayHigh: num(rawMeta.regularMarketDayHigh),
    dayLow: num(rawMeta.regularMarketDayLow),
    fiftyTwoWeekHigh: num(rawMeta.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: num(rawMeta.fiftyTwoWeekLow),
    volume: num(rawMeta.regularMarketVolume)
  };

  const body = { ok: true, symbol, range, interval, intraday, meta, candles };
  writeCache(cacheKey, body);

  return NextResponse.json(body, { headers: CACHE_HEADERS });
}
