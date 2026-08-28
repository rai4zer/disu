import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { computeDayChange, tryGetQuoteInCurrency, inferCurrencyFromTicker } from "@/app/lib/market/market-provider";
import {
  deleteManualPosition,
  getManualPositionById,
  type ManualAccountType,
  updateManualPosition
} from "@/app/lib/portfolio/manual-store";

type UpdatePositionBody = {
  ticker?: string;
  shares?: number;
  average_cost?: number | null;
  account_type?: ManualAccountType | null;
  broker?: string | null;
  currency?: string | null;
};

const ACCOUNT_TYPES = new Set<ManualAccountType>(["ISK", "AF", "KF", "Other"]);

function parseBody(body: unknown): UpdatePositionBody {
  if (!body || typeof body !== "object") {
    return {};
  }
  return body as UpdatePositionBody;
}

export async function PATCH(request: NextRequest, context: { params: { positionId: string } }) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const positionId = String(context.params.positionId ?? "").trim();
  if (!positionId) {
    return NextResponse.json({ error: "Position id is required." }, { status: 400 });
  }

  const existing = await getManualPositionById(session.userId, positionId);
  if (!existing) {
    return NextResponse.json({ error: "Manual position not found." }, { status: 404 });
  }

  const body = parseBody(await request.json().catch(() => ({})));
  const ticker = body.ticker !== undefined ? String(body.ticker ?? "").trim().toUpperCase() : existing.ticker;
  const shares = body.shares !== undefined ? Number(body.shares) : existing.shares;
  const averageCost = body.average_cost !== undefined ? (body.average_cost === null ? null : Number(body.average_cost)) : existing.avgCost;
  const accountType = body.account_type !== undefined ? body.account_type : existing.accountType;
  const broker = body.broker !== undefined ? String(body.broker ?? "").trim() || null : existing.broker;
  const requestedCurrency = body.currency !== undefined ? String(body.currency ?? "").trim().toUpperCase() : existing.currency;

  if (!/^[A-Z0-9.\-]{1,16}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker format." }, { status: 400 });
  }
  if (!Number.isFinite(shares) || shares <= 0) {
    return NextResponse.json({ error: "Shares must be a positive number." }, { status: 400 });
  }
  if (averageCost !== null && (!Number.isFinite(averageCost) || averageCost < 0)) {
    return NextResponse.json({ error: "Average cost must be zero or positive." }, { status: 400 });
  }
  if (accountType !== null && accountType !== undefined && !ACCOUNT_TYPES.has(accountType)) {
    return NextResponse.json({ error: "Invalid account type." }, { status: 400 });
  }

  const currency = requestedCurrency || inferCurrencyFromTicker(ticker);
  const updated = await updateManualPosition(session.userId, positionId, {
    ticker,
    shares,
    avgCost: averageCost,
    accountType: accountType ?? null,
    broker,
    currency
  });

  if (!updated) {
    return NextResponse.json({ error: "Manual position not found." }, { status: 404 });
  }

  // Null when no live source could price it and synthetic fallback is off.
  // The holding is still saved — the user owns it either way; only the price is
  // missing, and the row says so rather than carrying an invented number.
  const quote = await tryGetQuoteInCurrency(updated.ticker, updated.currency);
  const positionValue = quote === null ? null : updated.shares * quote.price;
  const unrealizedPnl =
    quote === null || updated.avgCost === null ? null : updated.shares * (quote.price - updated.avgCost);
  const dayChange = quote === null ? null : computeDayChange(quote, updated.shares);

  return NextResponse.json({
    position: {
      id: updated.id,
      source: "manual",
      ticker: updated.ticker,
      symbol: updated.ticker,
      name: updated.ticker,
      shares: updated.shares,
      quantity: updated.shares,
      avgCost: updated.avgCost,
      currentPrice: quote?.price ?? null,
      positionValue,
      marketValue: positionValue,
      unrealizedPnl,
      accountType: updated.accountType,
      broker: updated.broker,
      currency: quote?.currency ?? updated.currency,
      asOf: quote?.asOf ?? new Date().toISOString(),
      connectionId: null,
      previousClose: quote?.previousClose ?? null,
      dayChangePct: dayChange?.pct ?? null,
      dayChangeAmount: dayChange?.amount ?? null,
      priceSource: quote?.source ?? "unavailable",
      synthetic: quote?.synthetic ?? false
    }
  });
}

export async function DELETE(request: NextRequest, context: { params: { positionId: string } }) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const positionId = String(context.params.positionId ?? "").trim();
  if (!positionId) {
    return NextResponse.json({ error: "Position id is required." }, { status: 400 });
  }

  const deleted = await deleteManualPosition(session.userId, positionId);
  if (!deleted) {
    return NextResponse.json({ error: "Manual position not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
