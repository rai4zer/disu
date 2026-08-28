/**
 * The portfolio value series behind the dashboard chart.
 *
 * Reads what the daily sweep wrote (migration 0021) and adds nothing — no gap
 * filling, no carry-forward, no interpolation. A day with no row is a day
 * nothing could be observed, and the chart has to show that as a break in the
 * line rather than draw through it (docs/synthetic-data-policy.md).
 *
 * Which of the stored days may be joined into one line is decided by
 * `toComparableSeries()`; see the note there before relaxing anything.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { toComparableSeries } from "@/app/lib/portfolio/history-series";
import { listPortfolioSnapshots } from "@/app/lib/portfolio/snapshots";

const MAX_POINTS = 1_825;

export async function GET(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await listPortfolioSnapshots(session.userId, { limit: MAX_POINTS });
  return NextResponse.json(toComparableSeries(rows));
}
