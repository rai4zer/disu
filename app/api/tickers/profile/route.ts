import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 8000;

export type TickerProfile = {
  symbol: string;
  name: string | null;
  exchange: string | null;
  currency: string | null;
  marketCap: number | null;
  price: number | null;
  changePercent: number | null;
  peRatio: number | null;
  volume: number | null;
  source: "quote" | "quoteSummary" | "chart";
};

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "FinanceAutomation/1.0"
      },
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

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

// v7 carries every field we need, but Yahoo increasingly gates it behind a crumb.
async function fromQuote(symbol: string): Promise<TickerProfile | null> {
  const json = (await fetchJson(
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`
  )) as { quoteResponse?: { result?: Array<Record<string, unknown>> } };

  const result = json.quoteResponse?.result?.[0];
  if (!result) {
    return null;
  }

  return {
    symbol: str(result.symbol) ?? symbol,
    name: str(result.longName) ?? str(result.shortName),
    exchange: str(result.fullExchangeName) ?? str(result.exchange),
    currency: str(result.currency)?.toUpperCase() ?? null,
    marketCap: num(result.marketCap),
    price: num(result.regularMarketPrice),
    changePercent: num(result.regularMarketChangePercent),
    peRatio: num(result.trailingPE),
    volume: num(result.regularMarketVolume),
    source: "quote"
  };
}

async function fromQuoteSummary(symbol: string): Promise<TickerProfile | null> {
  const json = (await fetchJson(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price,summaryDetail`
  )) as {
    quoteSummary?: { result?: Array<{ price?: Record<string, unknown>; summaryDetail?: Record<string, unknown> }> };
  };

  const price = json.quoteSummary?.result?.[0]?.price;
  if (!price) {
    return null;
  }
  const summary = json.quoteSummary?.result?.[0]?.summaryDetail ?? {};

  const unwrap = (source: Record<string, unknown>, key: string): unknown => {
    const field = source[key];
    if (field && typeof field === "object" && "raw" in (field as Record<string, unknown>)) {
      return (field as Record<string, unknown>).raw;
    }
    return field;
  };
  const raw = (key: string): unknown => unwrap(price, key);

  return {
    symbol: str(price.symbol) ?? symbol,
    name: str(price.longName) ?? str(price.shortName),
    exchange: str(price.exchangeName) ?? str(price.exchange),
    currency: str(price.currency)?.toUpperCase() ?? null,
    marketCap: num(raw("marketCap")),
    price: num(raw("regularMarketPrice")),
    changePercent: num(raw("regularMarketChangePercent")) !== null ? Number(raw("regularMarketChangePercent")) * 100 : null,
    peRatio: num(unwrap(summary, "trailingPE")),
    volume: num(raw("regularMarketVolume")) ?? num(unwrap(summary, "volume")),
    source: "quoteSummary"
  };
}

// Always reachable, but carries no market cap or P/E.
async function fromChart(symbol: string): Promise<TickerProfile | null> {
  const json = (await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`
  )) as { chart?: { result?: Array<{ meta?: Record<string, unknown> }> } };

  const meta = json.chart?.result?.[0]?.meta;
  if (!meta) {
    return null;
  }

  const price = num(meta.regularMarketPrice);
  const previous = num(meta.chartPreviousClose) ?? num(meta.previousClose);

  return {
    symbol: str(meta.symbol) ?? symbol,
    name: str(meta.longName) ?? str(meta.shortName),
    exchange: str(meta.fullExchangeName) ?? str(meta.exchangeName),
    currency: str(meta.currency)?.toUpperCase() ?? null,
    marketCap: null,
    price,
    changePercent: price !== null && previous !== null && previous > 0 ? ((price - previous) / previous) * 100 : null,
    peRatio: null,
    volume: num(meta.regularMarketVolume),
    source: "chart"
  };
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

  // Each source is a strict superset fallback: quote > quoteSummary > chart.
  for (const resolve of [fromQuote, fromQuoteSummary, fromChart]) {
    try {
      const profile = await resolve(symbol);
      if (profile) {
        return NextResponse.json(
          { ok: true, profile },
          { headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" } }
        );
      }
    } catch {
      // Try the next source.
    }
  }

  return NextResponse.json({ ok: true, profile: null });
}
