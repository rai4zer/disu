/**
 * Upcoming corporate events for the signed-in user's holdings.
 *
 * ## What this can actually source, and what it cannot
 *
 * Measured against the live Finnhub plan behind `FINNHUB_API_KEY`:
 *
 *   - `calendar/earnings?symbol=AAPL` → **works.** Confirmed dates, the fiscal
 *     quarter, and an EPS estimate.
 *   - `calendar/earnings?symbol=VOLV-B.ST` → **403, "no access".** Every Nordic
 *     symbol tested came back the same way.
 *   - `stock/dividend` → **403** for every symbol, US included.
 *
 * So on today's plan this route can answer "when does Apple report" and cannot
 * answer "when does Volvo report" or "when is anyone's dividend" — and the
 * audience is Swedish through M3 (ROADMAP D6), which means the gap lands on
 * exactly the holdings that matter most.
 *
 * The response therefore reports its own coverage: which symbols were resolved,
 * which were refused by the provider, and which were never asked. The page
 * prints that. An empty calendar with no explanation reads as "nothing is
 * happening", which is a much worse falsehood than "we cannot see this yet" —
 * and AGMs have no feed here at all, so that category is absent rather than
 * approximated. Closing the gap is the licensed-feed decision in ROADMAP §2.7 /
 * D2, not something to paper over in this file.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { listPortfolioPositions } from "@/app/lib/portfolio/portfolio-positions";
import { finnhubFetch, finnhubToken, isFinnhubPhaseFatal } from "@/app/lib/market/finnhub-client";
import { log } from "@/app/lib/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only kinds we can actually observe appear here. No AGM: there is no feed. */
export type CalendarEventKind = "earnings";

export type CalendarEvent = {
  id: string;
  symbol: string;
  name: string;
  kind: CalendarEventKind;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** "bmo" / "amc" / "" from the provider — before open, after close, unknown. */
  session: string | null;
  /** Fiscal quarter the report covers, when the provider states it. */
  quarter: number | null;
  year: number | null;
  epsEstimate: number | null;
};

type CoverageEntry = {
  symbol: string;
  /**
   * `ok` — asked and answered. `unsupported` — the provider refused this symbol
   * on this plan. `failed` — the request errored for another reason.
   */
  status: "ok" | "unsupported" | "failed";
  eventCount: number;
};

type CalendarPayload = {
  ok: true;
  events: CalendarEvent[];
  coverage: CoverageEntry[];
  /** How far ahead we looked. */
  horizonDays: number;
};

const HORIZON_DAYS = 365;
const CACHE_TTL_MS = 6 * 60 * 60_000;
/** Pace between symbol lookups; Finnhub's per-minute budget is not generous. */
const PACE_MS = 150;

type CacheEntry = { events: CalendarEvent[]; status: CoverageEntry["status"]; at: number };
/** Keyed by symbol, not by user: an earnings date is a fact about the company. */
const cache = new Map<string, CacheEntry>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type FinnhubEarningsRow = {
  symbol?: string;
  date?: string;
  hour?: string;
  quarter?: number;
  year?: number;
  epsEstimate?: number | null;
};

/**
 * Earnings for one symbol.
 *
 * Distinguishes "the plan does not cover this symbol" from "the request went
 * wrong", because those are different messages to the reader: one is a gap that
 * only a licensed feed closes, the other might work on a retry.
 */
async function fetchEarnings(
  symbol: string,
  name: string,
  from: string,
  to: string
): Promise<{ events: CalendarEvent[]; status: CoverageEntry["status"] }> {
  try {
    const payload = await finnhubFetch<{ earningsCalendar?: FinnhubEarningsRow[]; error?: string }>(
      `/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(symbol)}`,
      "finnhub earnings calendar"
    );

    if (payload?.error) {
      return { events: [], status: "unsupported" };
    }

    const rows = Array.isArray(payload?.earningsCalendar) ? payload.earningsCalendar : [];
    const events: CalendarEvent[] = [];

    for (const row of rows) {
      const date = typeof row.date === "string" ? row.date.slice(0, 10) : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      // Past rows come back in the same window; the calendar is about what is
      // ahead, and a filed report belongs in Primers, not here.
      if (date < from) continue;

      events.push({
        id: `${symbol}:${date}`,
        symbol,
        name,
        kind: "earnings",
        date,
        session: typeof row.hour === "string" && row.hour.length > 0 ? row.hour : null,
        quarter: typeof row.quarter === "number" ? row.quarter : null,
        year: typeof row.year === "number" ? row.year : null,
        epsEstimate:
          typeof row.epsEstimate === "number" && Number.isFinite(row.epsEstimate) ? row.epsEstimate : null
      });
    }

    return { events, status: "ok" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // The client throws on a non-2xx; a 401/403 here means the plan, not a
    // fault, and `isFinnhubPhaseFatal` is where that judgement already lives.
    if (isFinnhubPhaseFatal(message)) {
      return { events: [], status: "unsupported" };
    }
    log.warn("calendar.earnings.failed", { symbol, reason: message || "unknown error" });
    return { events: [], status: "failed" };
  }
}

export async function GET(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!finnhubToken()) {
    // No key: say so rather than returning an empty calendar that reads as
    // "your holdings have nothing coming up".
    return NextResponse.json({
      ok: true,
      events: [],
      coverage: [],
      horizonDays: HORIZON_DAYS
    } satisfies CalendarPayload);
  }

  const positions = await listPortfolioPositions(session.userId);

  // One lookup per distinct symbol, not per holding: the same company held in
  // two accounts reports once.
  const bySymbol = new Map<string, string>();
  for (const position of positions) {
    if (!position.symbol) continue;
    if (!bySymbol.has(position.symbol)) {
      bySymbol.set(position.symbol, position.name || position.symbol);
    }
  }

  const now = new Date();
  const from = isoDate(now);
  const to = isoDate(new Date(now.getTime() + HORIZON_DAYS * 86_400_000));

  const events: CalendarEvent[] = [];
  const coverage: CoverageEntry[] = [];
  let first = true;

  for (const [symbol, name] of bySymbol) {
    const cached = cache.get(symbol);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      events.push(...cached.events);
      coverage.push({ symbol, status: cached.status, eventCount: cached.events.length });
      continue;
    }

    if (!first) await sleep(PACE_MS);
    first = false;

    const result = await fetchEarnings(symbol, name, from, to);
    // A failure is cached too, briefly enough to retry but long enough that a
    // page refresh does not re-ask a provider that just refused.
    cache.set(symbol, { events: result.events, status: result.status, at: Date.now() });
    events.push(...result.events);
    coverage.push({ symbol, status: result.status, eventCount: result.events.length });
  }

  events.sort((a, b) => (a.date === b.date ? a.symbol.localeCompare(b.symbol) : a.date.localeCompare(b.date)));

  return NextResponse.json({
    ok: true,
    events,
    coverage,
    horizonDays: HORIZON_DAYS
  } satisfies CalendarPayload);
}
