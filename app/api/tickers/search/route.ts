import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { getMarketProvider } from "@/app/lib/market/market-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

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
