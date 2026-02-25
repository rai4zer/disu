import { NextRequest, NextResponse } from "next/server";
import { buildTickerSuggestions } from "@/app/lib/ticker-suggestions";
import { getSessionFromRequest } from "@/app/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type YahooSearchResponse = {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    quoteType?: string;
  }>;
};

function fallbackSuggestions(query: string, limit: number) {
  return buildTickerSuggestions(query, limit).map((item) => ({
    symbol: item.symbol,
    name: item.name,
    label: item.label
  }));
}

async function fetchYahooSuggestions(query: string, limit: number) {
  const url = new URL("https://query2.finance.yahoo.com/v1/finance/search");
  url.searchParams.set("q", query);
  url.searchParams.set("quotesCount", String(Math.max(10, limit * 2)));
  url.searchParams.set("newsCount", "0");
  url.searchParams.set("enableFuzzyQuery", "true");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "FinanceAutomation/1.0"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Ticker search failed with status ${response.status}`);
  }

  const json = (await response.json()) as YahooSearchResponse;
  const quotes = Array.isArray(json.quotes) ? json.quotes : [];

  return quotes
    .filter((quote) => {
      const symbol = String(quote.symbol ?? "").trim().toUpperCase();
      const type = String(quote.quoteType ?? "").toUpperCase();
      return symbol.length > 0 && symbol.length <= 12 && ["EQUITY", "ETF", "MUTUALFUND"].includes(type);
    })
    .map((quote) => {
      const symbol = String(quote.symbol ?? "").trim().toUpperCase();
      const name = String(quote.shortname ?? quote.longname ?? symbol).trim();
      return {
        symbol,
        name,
        label: `${symbol} - ${name}`
      };
    })
    .filter((item, idx, arr) => arr.findIndex((x) => x.symbol === item.symbol) === idx)
    .slice(0, limit);
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(20, Math.round(limitRaw))) : 10;

  if (!query) {
    return NextResponse.json({ ok: true, suggestions: fallbackSuggestions("", limit) });
  }

  try {
    const yahoo = await fetchYahooSuggestions(query, limit);
    const merged = [
      ...yahoo,
      ...fallbackSuggestions(query, limit).map((item) => ({ symbol: item.symbol, name: item.name, label: item.label }))
    ].filter((item, idx, arr) => arr.findIndex((x) => x.symbol === item.symbol) === idx);
    return NextResponse.json({ ok: true, suggestions: merged.slice(0, limit) });
  } catch {
    return NextResponse.json({ ok: true, suggestions: fallbackSuggestions(query, limit) });
  }
}
