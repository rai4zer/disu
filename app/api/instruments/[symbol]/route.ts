/**
 * Instrument detail: profile, financials, news and analyst estimates.
 *
 * One route for all four tabs, because they are one bridge call — the ~3s cost
 * is interpreter start and the yfinance import, so four endpoints would pay it
 * four times (app/lib/market/instrument-bridge.ts).
 *
 * `sections` tells the page which tabs it may render. Only equities carry
 * financials and analyst coverage, and an index carries no news either, so a
 * fixed four-tab layout would show gold an empty "KPI" tab — a promise the data
 * cannot keep (docs/synthetic-data-policy.md).
 *
 * A symbol nobody has data for is a 404, not an empty page shell.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { getInstrumentDetail } from "@/app/lib/market/instrument-cache";
import { isInstrumentBridgeConfigured, normaliseSymbol } from "@/app/lib/market/instrument-bridge";
import { log } from "@/app/lib/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { symbol: string } }) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const symbol = normaliseSymbol(decodeURIComponent(params.symbol ?? ""));
  if (!symbol) {
    return NextResponse.json({ ok: false, error: "Malformed symbol." }, { status: 400 });
  }

  if (!isInstrumentBridgeConfigured()) {
    // A deployment without a Python interpreter cannot serve this page at all.
    // 503 rather than an empty 200: there is nothing to render, and a page
    // shell with no data reads as "this instrument has none".
    return NextResponse.json(
      { ok: false, error: "Instrument detail is unavailable on this deployment." },
      { status: 503 }
    );
  }

  try {
    const { detail, fetchedAt, cached } = await getInstrumentDetail(symbol);
    return NextResponse.json(
      { ok: true, ...detail, fetchedAt, cached },
      // Short public cache: the payload is identical for every viewer, and the
      // upstream TTL is an hour anyway.
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn("market.instrument.route.failed", { symbol, error: message });
    // The bridge says "No instrument data for X" for an unknown symbol; that is
    // a 404 about a thing that does not exist, not a 500 about our failure.
    const missing = /No instrument data|Malformed symbol/i.test(message);
    return NextResponse.json(
      { ok: false, error: missing ? `No data for ${symbol}.` : "Could not load this instrument." },
      { status: missing ? 404 : 502 }
    );
  }
}
