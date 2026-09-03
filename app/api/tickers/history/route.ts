import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 8000;

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

  return NextResponse.json(
    { ok: true, symbol, range, interval, intraday, meta, candles },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" } }
  );
}
