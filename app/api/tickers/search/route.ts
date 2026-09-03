import { NextRequest, NextResponse } from "next/server";
import { getMarketProvider } from "@/app/lib/market/market-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Deliberately open. Search is how a visitor reaches an instrument page, and
  // those are public (ROADMAP §4.6) — gating the search would gate the door to
  // them. Nothing here is user-scoped: the same query returns the same
  // suggestions for everyone, and no row of anyone's data is involved.
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(20, Math.round(limitRaw))) : 10;

  const provider = getMarketProvider();
  try {
    const suggestions = await provider.searchTickers(query, limit);
    return NextResponse.json({ ok: true, suggestions });
  } catch {
    return NextResponse.json({ ok: true, suggestions: [] });
  }
}
