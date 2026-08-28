import { finnhubFetch, finnhubToken } from "@/app/lib/market/market-provider";
import { NextResponse } from "next/server";
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

type IndexDef = {
  label: string;
  fullName: string;
  // Yahoo symbols in priority order (first one that resolves wins).
  yahooSymbols: string[];
  // Finnhub symbol guesses, tried after the index-list lookup below.
  finnhubSymbols: string[];
  // Matched against Finnhub's index list (normalized description/symbol).
  finnhubMatchers: Array<(normalized: string) => boolean>;
};

// The strip renders these in order.
const INDEX_DEFS: IndexDef[] = [
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

const FALLBACK_ITEMS: MarketItem[] = INDEX_DEFS.map((def) => ({
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
const lastReadingByLabel = new Map<string, Reading>();
// When the per-index chart fallback is in play, Yahoo only tolerates a couple of
// requests per window — so each refresh renews a slice of the strip and the rest
// keep their retained values. Never-fetched indices go first, then the stalest.
const lastChartAttemptByLabel = new Map<string, number>();
const CHART_REFRESH_BATCH = 3;

function pickChartRefreshTargets(): number[] {
  const order = INDEX_DEFS.map((def, index) => ({
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

function mergeWithLastReadings(readings: Array<Reading | null>): Array<Reading | null> {
  return INDEX_DEFS.map((def, index) => {
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
  const readings = INDEX_DEFS.map((def) => lastReadingByLabel.get(def.label) ?? null);
  return readings.some(Boolean) ? toItems(readings) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type IndicesPayload = {
  ok: true;
  items: MarketItem[];
  stale: boolean;
  asOf: string;
  source: string;
  reason?: string;
};

type Reading = { price: number; changePct: number; ts: number };

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

async function fetchYahooQuote(
  symbols: string,
  host: "query1.finance.yahoo.com" | "query2.finance.yahoo.com",
  signal: AbortSignal
): Promise<Response> {
  return fetch(`https://${host}/v7/finance/quote?symbols=${symbols}`, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9"
    },
    cache: "no-store",
    signal
  });
}

async function fetchYahooChart(
  symbol: string,
  host: "query1.finance.yahoo.com" | "query2.finance.yahoo.com",
  signal: AbortSignal
): Promise<Response> {
  const encoded = encodeURIComponent(symbol);
  return fetch(`https://${host}/v8/finance/chart/${encoded}?interval=1d&range=2d`, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9"
    },
    cache: "no-store",
    signal
  });
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

function toItems(readings: Array<Reading | null>): MarketItem[] {
  return INDEX_DEFS.map((def, index) => {
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

async function fetchFinnhubIndexList(signal: AbortSignal): Promise<FinnhubIndexRow[]> {
  const payload = await finnhubFetch<unknown>("/index/list", "finnhub index list", signal);
  if (!Array.isArray(payload)) {
    throw new Error("finnhub index list: invalid payload");
  }
  return payload as FinnhubIndexRow[];
}

function resolveFinnhubIndexSymbol(
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

async function fetchFinnhubIndexCandle(symbol: string, signal: AbortSignal): Promise<Reading> {
  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = nowSec - 7 * 24 * 60 * 60;
  const payload = await finnhubFetch<{
    c?: unknown;
    t?: unknown;
    s?: unknown;
  }>(
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
  const ts = times[times.length - 1];
  return {
    price: latest,
    changePct: ((latest - prev) / prev) * 100,
    ts
  };
}

// A 403 means the plan doesn't include index data and a 429 means we're over the
// call budget — in both cases every further symbol would fail the same way, so the
// caller stops the whole Finnhub phase rather than working through nine indices.
function isFinnhubPhaseFatal(message: string): boolean {
  return message.includes("HTTP 403") || message.includes("HTTP 429") || message.includes("HTTP 401");
}

async function pickFinnhubIndex(symbols: string[], signal: AbortSignal) {
  let lastReason = "";
  for (const symbol of symbols) {
    try {
      const candle = await fetchFinnhubIndexCandle(symbol, signal);
      if (candle) {
        return { candle, reason: "", fatal: false };
      }
    } catch (error) {
      lastReason = error instanceof Error ? error.message : `finnhub candle ${symbol}: unknown error`;
      if (isFinnhubPhaseFatal(lastReason)) {
        return { candle: null as Reading | null, reason: lastReason, fatal: true };
      }
    }
  }
  return { candle: null as Reading | null, reason: lastReason, fatal: false };
}

async function computeIndices(): Promise<IndicesPayload> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    let reason = "";
    // Token presence is read through the shared helper so there is one
    // definition of "Finnhub is configured" across the app.
    if (finnhubToken()) {
      let finnhubListReason = "";
      let finnhubList: FinnhubIndexRow[] = [];
      try {
        finnhubList = await fetchFinnhubIndexList(controller.signal);
      } catch (error) {
        finnhubListReason = error instanceof Error ? error.message : "finnhub index list: unknown error";
      }

      const rawReadings: Array<Reading | null> = [];
      const finnhubReasons: string[] = [finnhubListReason];
      let finnhubDead = false;
      for (const def of INDEX_DEFS) {
        if (finnhubDead) {
          rawReadings.push(null);
          continue;
        }
        const resolved = resolveFinnhubIndexSymbol(finnhubList, def.finnhubMatchers);
        const candidates = [resolved, ...def.finnhubSymbols].filter((v): v is string => Boolean(v));
        const row = await pickFinnhubIndex(candidates, controller.signal);
        finnhubReasons.push(row.reason);
        finnhubDead = row.fatal;
        rawReadings.push(row.candle);
      }
      const finnhubReason = finnhubReasons.filter(Boolean).join(" | ");

      // Judge this source on what it returned now, not on retained values —
      // otherwise a single past success would keep us from ever refreshing.
      const hasLive = rawReadings.some(Boolean);
      if (hasLive) {
        const readings = mergeWithLastReadings(rawReadings);
        const items = toItems(readings);
        clearTimeout(timeout);
        const asOf = new Date().toISOString();
        lastKnownItems = items;
        lastKnownAsOf = asOf;
        const stale = readings.some((row) => !row);
        return { ok: true, items, stale, asOf, source: "finnhub" };
      }
      reason = finnhubReason || "finnhub configured but returned no live index values";
      log.warn("market.indices.finnhub.empty", { reason });
    }

    const symbols = encodeURIComponent(INDEX_DEFS.flatMap((def) => def.yahooSymbols).join(","));
    let response: Response | null = null;
    let source = "query1.finance.yahoo.com";
    for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"] as const) {
      try {
        const candidate = await fetchYahooQuote(symbols, host, controller.signal);
        if (candidate.ok) {
          response = candidate;
          source = host;
          break;
        }
        reason = `${host}: HTTP ${candidate.status}`;
      } catch (error) {
        reason = error instanceof Error ? `${host}: ${error.message}` : `${host}: unknown error`;
      }
    }
    clearTimeout(timeout);
    if (response) {
      const payload = (await response.json()) as {
        quoteResponse?: {
          result?: Array<{
            symbol?: string;
            regularMarketPrice?: number;
            regularMarketChangePercent?: number;
            regularMarketTime?: number;
          }>;
        };
      };
      const map = new Map((payload.quoteResponse?.result ?? []).map((item) => [item.symbol ?? "", item]));
      const pick = (candidates: string[]): Reading | null => {
        for (const symbol of candidates) {
          const row = map.get(symbol);
          if (row && Number.isFinite(Number(row.regularMarketChangePercent))) {
            return {
              price: Number(row.regularMarketPrice ?? 0),
              changePct: Number(row.regularMarketChangePercent ?? 0),
              ts: Number(row.regularMarketTime ?? 0)
            };
          }
        }
        return null;
      };
      const rawReadings = INDEX_DEFS.map((def) => pick(def.yahooSymbols));
      if (rawReadings.some(Boolean)) {
        const readings = mergeWithLastReadings(rawReadings);
        const items = toItems(readings);
        const stale = readings.some((row) => !row);
        const asOf = new Date().toISOString();
        lastKnownItems = items;
        lastKnownAsOf = asOf;
        return { ok: true, items, stale, asOf, source };
      }
      // Responded, but with nothing usable — try the chart endpoint below.
      reason = `${source}: quote response had no usable index rows`;
    }

    // Fallback strategy: Yahoo chart endpoint (often available when quote endpoint returns 401).
    // One request per index, so this phase is paced and gives up as soon as Yahoo
    // rate-limits us rather than firing a burst it will only reject.
    const chartController = new AbortController();
    const chartTimeout = setTimeout(() => chartController.abort(), 12_000);
    let rateLimited = false;
    const chartPick = async (symbolsToTry: string[]): Promise<Reading | null> => {
      for (const s of symbolsToTry) {
        for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"] as const) {
          try {
            const res = await fetchYahooChart(s, host, chartController.signal);
            if (!res.ok) {
              reason = `${host} chart ${s}: HTTP ${res.status}`;
              if (res.status === 429) {
                rateLimited = true;
                return null;
              }
              continue;
            }
            const payload = (await res.json()) as {
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
            const ts = Number(meta?.regularMarketTime ?? 0);
            if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(previous) || previous <= 0) {
              continue;
            }
            const changePct = ((price - previous) / previous) * 100;
            return { price, changePct, ts };
          } catch (error) {
            reason = error instanceof Error ? `${host} chart ${s}: ${error.message}` : `${host} chart ${s}: unknown error`;
          }
        }
      }
      return null;
    };

    const targets = pickChartRefreshTargets();
    const rawChartReadings: Array<Reading | null> = INDEX_DEFS.map(() => null);
    for (const [position, index] of targets.entries()) {
      if (rateLimited) break;
      if (position > 0) {
        await sleep(800);
      }
      const def = INDEX_DEFS[index];
      lastChartAttemptByLabel.set(def.label, Date.now());
      rawChartReadings[index] = await chartPick(def.yahooSymbols);
    }
    clearTimeout(chartTimeout);
    if (rawChartReadings.some(Boolean)) {
      const chartReadings = mergeWithLastReadings(rawChartReadings);
      const chartItems = toItems(chartReadings);
      const asOf = new Date().toISOString();
      lastKnownItems = chartItems;
      lastKnownAsOf = asOf;
      const stale = chartReadings.some((row) => !row);
      return { ok: true, items: chartItems, stale, asOf, source: "yahoo-chart-fallback" };
    }

    {
      // Nothing fresh anywhere: serve retained per-index readings if we have any.
      const items = retainedItems() ?? lastKnownItems ?? FALLBACK_ITEMS;
      const asOf = lastKnownAsOf || new Date().toISOString();
      const keyHint = finnhubToken() ? "" : " (FINNHUB_API_KEY not configured)";
      log.warn("market.indices.fetch.failed", { reason: `${reason}${keyHint}` });
      return { ok: true, items, stale: true, asOf, source: "fallback", reason };
    }
  } catch {
    const items = lastKnownItems ?? FALLBACK_ITEMS;
    const asOf = lastKnownAsOf || new Date().toISOString();
    return { ok: true, items, stale: true, asOf, source: "fallback" };
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
