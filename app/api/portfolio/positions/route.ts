import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { initJobWorker } from "@/app/lib/jobs/processor";
import { listConnections } from "@/app/lib/brokers/store";
import { computeDayChange, tryGetQuoteInCurrency, inferCurrencyFromTicker } from "@/app/lib/market/market-provider";
import { listPortfolioWithTotals } from "@/app/lib/portfolio/portfolio-positions";
import { createManualPosition, type ManualAccountType } from "@/app/lib/portfolio/manual-store";
import { recordFunnelEvent } from "@/app/lib/analytics/funnel-store";

type CreatePositionBody = {
  ticker?: string;
  shares?: number;
  average_cost?: number | null;
  account_type?: ManualAccountType | null;
  broker?: string | null;
  currency?: string | null;
};

const ACCOUNT_TYPES = new Set<ManualAccountType>(["ISK", "AF", "KF", "Other"]);

function parseBody(body: unknown): CreatePositionBody {
  if (!body || typeof body !== "object") {
    return {};
  }
  return body as CreatePositionBody;
}

export async function GET(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Starts the background worker if this process has not run one yet. The other
  // callers are the quant and primer routes, so on an instance where nobody uses
  // those, nothing would ever start the daily snapshot sweep — and a day of
  // portfolio history missed is a day that cannot be recovered (migration 0021).
  // Every holder loads this route, which makes it the one place guaranteed to be
  // hit by exactly the people who have something to snapshot.
  initJobWorker();

  // The total is computed here, next to the rows it describes, rather than in
  // the page. A client-side reduce over mixed currencies is how the old total
  // came to be wrong (ROADMAP §2.7).
  const { positions, totals } = await listPortfolioWithTotals(session.userId);
  return NextResponse.json({
    positions,
    totals,
    connections: await listConnections(session.userId)
  });
}

export async function POST(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = parseBody(await request.json().catch(() => ({})));
  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  const shares = Number(body.shares);
  const averageCostRaw = body.average_cost;
  const averageCost = averageCostRaw === null || averageCostRaw === undefined ? null : Number(averageCostRaw);
  const accountTypeRaw = body.account_type ?? null;
  const broker = String(body.broker ?? "").trim() || null;
  const requestedCurrency = String(body.currency ?? "").trim().toUpperCase();

  if (!/^[A-Z0-9.\-]{1,16}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker format." }, { status: 400 });
  }
  if (!Number.isFinite(shares) || shares <= 0) {
    return NextResponse.json({ error: "Shares must be a positive number." }, { status: 400 });
  }
  if (averageCost !== null && (!Number.isFinite(averageCost) || averageCost < 0)) {
    return NextResponse.json({ error: "Average cost must be zero or positive." }, { status: 400 });
  }
  if (accountTypeRaw !== null && !ACCOUNT_TYPES.has(accountTypeRaw)) {
    return NextResponse.json({ error: "Invalid account type." }, { status: 400 });
  }

  const currency = requestedCurrency || inferCurrencyFromTicker(ticker);
  const created = await createManualPosition(session.userId, {
    ticker,
    shares,
    avgCost: averageCost,
    accountType: accountTypeRaw,
    broker,
    currency
  });

  // Activation, the step that matters most in the funnel: an account with an
  // empty portfolio is a dead account. Only the method and the count are
  // recorded — never the ticker, which is holdings data and has no business in
  // an analytics table (app/lib/analytics/funnel.ts).
  void recordFunnelEvent(request, "holding_added", {
    userId: session.userId,
    path: "/portfolio",
    properties: { method: "manual", count: 1 }
  });

  // Null when no live source could price it and synthetic fallback is off.
  // The holding is still saved — the user owns it either way; only the price is
  // missing, and the row says so rather than carrying an invented number.
  const quote = await tryGetQuoteInCurrency(created.ticker, created.currency);
  const positionValue = quote === null ? null : created.shares * quote.price;
  const unrealizedPnl =
    quote === null || created.avgCost === null ? null : created.shares * (quote.price - created.avgCost);
  const dayChange = quote === null ? null : computeDayChange(quote, created.shares);

  return NextResponse.json(
    {
      position: {
        id: created.id,
        source: "manual",
        ticker: created.ticker,
        symbol: created.ticker,
        name: created.ticker,
        shares: created.shares,
        quantity: created.shares,
        avgCost: created.avgCost,
        currentPrice: quote?.price ?? null,
        positionValue,
        marketValue: positionValue,
        unrealizedPnl,
        accountType: created.accountType,
        broker: created.broker,
        currency: quote?.currency ?? created.currency,
        asOf: quote?.asOf ?? new Date().toISOString(),
        connectionId: null,
        previousClose: quote?.previousClose ?? null,
        dayChangePct: dayChange?.pct ?? null,
        dayChangeAmount: dayChange?.amount ?? null,
        priceSource: quote?.source ?? "unavailable",
        synthetic: quote?.synthetic ?? false
      }
    },
    { status: 201 }
  );
}
