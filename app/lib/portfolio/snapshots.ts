/**
 * The daily portfolio-history writer.
 *
 * `positions` and `manual_positions` hold only *current* state — a broker sync
 * overwrites yesterday's market value in place — so what a portfolio was worth
 * last Tuesday exists only if something wrote it down that day. It cannot be
 * backfilled from anything, at any price, which is why this runs from M0 even
 * though the chart it feeds is an M3 feature (ROADMAP §5.1, §13 checklist).
 *
 * One row per user per day (migration 0021). `snapshot_date` is the bucket and
 * `captured_at` is when the valuation was actually observed; the first capture
 * of a day wins, so the pair says "this is what it was worth at that moment",
 * not "this is the close".
 *
 * What may be written is decided by `computePortfolioValuation()`, which refuses
 * to record placeholder prices — see the note there before relaxing anything.
 */

import { eq, SupabaseRequestError } from "@/app/lib/db/supabase";
import { systemRequest, userScoped } from "@/app/lib/db/user-scope";
import { getDisplayCurrency } from "@/app/lib/market/market-provider";
import { log } from "@/app/lib/observability/log";
import { listPortfolioPositions } from "@/app/lib/portfolio/portfolio-positions";
import { computePortfolioValuation } from "@/app/lib/portfolio/snapshot-value";

export type PortfolioSnapshotRow = {
  id: string;
  user_id: string;
  snapshot_date: string;
  captured_at: string;
  currency: string;
  total_value: number;
  cost_basis: number | null;
  costed_value: number | null;
  position_count: number;
  valued_position_count: number;
};

const SNAPSHOT_COLUMNS =
  "id,user_id,snapshot_date,captured_at,currency,total_value,cost_basis,costed_value,position_count,valued_position_count";

/**
 * How many holders one sweep will look at.
 *
 * A cap that silently truncated would read as "everyone was snapshotted" while
 * quietly dropping the tail of the user base, so hitting it is logged as a
 * warning rather than absorbed (`portfolio.snapshot.sweep.truncated`).
 */
const HOLDER_SCAN_LIMIT = 5_000;

export type SnapshotOutcome =
  /** A row was written. */
  | "captured"
  /** A row for this date already existed — this sweep or another instance. */
  | "already_captured"
  /** Nothing observable to record; deliberately leaves a gap in the series. */
  | "nothing_to_record";

/**
 * The date bucket a capture belongs to, in UTC.
 *
 * UTC rather than a market timezone because it has to agree with the unique
 * index in Postgres, which stores a `date` and knows nothing about where the
 * holder lives. `captured_at` carries the precise instant for anyone who needs
 * to know where in the day the reading was taken.
 */
export function snapshotDateFor(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

async function hasSnapshotForDate(userId: string, date: string): Promise<boolean> {
  const rows = await userScoped<Pick<PortfolioSnapshotRow, "id">[]>(userId, "portfolio_snapshots", {
    query: {
      snapshot_date: eq(date),
      select: "id",
      limit: "1"
    }
  });
  return rows.length > 0;
}

/**
 * Records what one person's portfolio is worth right now, unless today is
 * already recorded.
 *
 * The pre-check is an optimisation, not the guarantee: it saves the quote and FX
 * lookups behind `listPortfolioPositions()` on a re-run. The guarantee is the
 * unique index, which is what makes two app instances sweeping at once safe —
 * the loser gets a 409 and reports `already_captured`.
 */
export async function captureDailySnapshot(
  userId: string,
  options: { date?: string } = {}
): Promise<SnapshotOutcome> {
  const date = options.date ?? snapshotDateFor();

  if (await hasSnapshotForDate(userId, date)) {
    return "already_captured";
  }

  const displayCurrency = getDisplayCurrency();
  const valuation = computePortfolioValuation(await listPortfolioPositions(userId), displayCurrency);
  if (valuation === null) {
    return "nothing_to_record";
  }

  try {
    await userScoped<PortfolioSnapshotRow[]>(userId, "portfolio_snapshots", {
      method: "POST",
      body: {
        snapshot_date: date,
        captured_at: new Date().toISOString(),
        currency: valuation.currency,
        total_value: valuation.totalValue,
        cost_basis: valuation.costBasis,
        costed_value: valuation.costedValue,
        position_count: valuation.positionCount,
        valued_position_count: valuation.valuedPositionCount
      },
      prefer: "return=minimal"
    });
    return "captured";
  } catch (error) {
    // 409 is the unique index doing its job against a concurrent sweep, which is
    // the expected outcome on a second instance rather than a failure.
    if (error instanceof SupabaseRequestError && error.status === 409) {
      return "already_captured";
    }
    throw error;
  }
}

export async function listPortfolioSnapshots(
  userId: string,
  options: { limit?: number } = {}
): Promise<PortfolioSnapshotRow[]> {
  const limit = Math.max(1, Math.min(3_650, Math.floor(options.limit ?? 365)));
  return userScoped<PortfolioSnapshotRow[]>(userId, "portfolio_snapshots", {
    query: {
      select: SNAPSHOT_COLUMNS,
      order: "snapshot_date.desc",
      limit: String(limit)
    }
  });
}

/** Everyone with something to value, from either source of holdings. */
async function listUserIdsWithHoldings(): Promise<{ userIds: string[]; truncated: boolean }> {
  const query = { select: "user_id", limit: String(HOLDER_SCAN_LIMIT + 1) };

  const [brokerRows, manualRows] = await Promise.all([
    systemRequest<{ user_id: string }[]>("positions", {
      reason: "the daily snapshot sweep values every tenant's portfolio, so it cannot be scoped to one",
      query
    }),
    systemRequest<{ user_id: string }[]>("manual_positions", {
      reason: "the daily snapshot sweep values every tenant's portfolio, so it cannot be scoped to one",
      query
    })
  ]);

  const truncated = brokerRows.length > HOLDER_SCAN_LIMIT || manualRows.length > HOLDER_SCAN_LIMIT;
  const userIds = [...new Set([...brokerRows, ...manualRows].map((row) => row.user_id).filter(Boolean))];
  return { userIds, truncated };
}

/** Who is already recorded for this date, so a re-run costs one query, not N. */
async function listUserIdsCapturedOn(date: string): Promise<Set<string>> {
  const rows = await systemRequest<{ user_id: string }[]>("portfolio_snapshots", {
    reason: "the daily snapshot sweep checks every tenant's row for today before valuing anything",
    query: {
      snapshot_date: eq(date),
      select: "user_id",
      limit: String(HOLDER_SCAN_LIMIT + 1)
    }
  });
  return new Set(rows.map((row) => row.user_id));
}

export type SnapshotSweepResult = {
  date: string;
  holders: number;
  captured: number;
  alreadyCaptured: number;
  nothingToRecord: number;
  failed: number;
  truncated: boolean;
};

/**
 * Captures today's snapshot for every holder who does not have one yet.
 *
 * Sequential on purpose. Each capture is several Yahoo quote and FX lookups on
 * an unofficial, rate-limited endpoint (architecture.md, Known constraints);
 * fanning the whole user base at it would trade a sweep that takes a while for a
 * sweep that gets throttled into placeholder prices — which this writer would
 * then refuse to record, turning a slow job into a missing day.
 *
 * One person's failure is contained to that person: the loop counts it and moves
 * on, because a single broken holding must not cost everybody else their day.
 */
export async function runDailySnapshotSweep(
  options: { date?: string } = {}
): Promise<SnapshotSweepResult> {
  const date = options.date ?? snapshotDateFor();
  const startedAt = Date.now();

  const [{ userIds, truncated }, capturedAlready] = await Promise.all([
    listUserIdsWithHoldings(),
    listUserIdsCapturedOn(date)
  ]);

  const result: SnapshotSweepResult = {
    date,
    holders: userIds.length,
    captured: 0,
    alreadyCaptured: 0,
    nothingToRecord: 0,
    failed: 0,
    truncated
  };

  if (truncated) {
    log.warn("portfolio.snapshot.sweep.truncated", { date, limit: HOLDER_SCAN_LIMIT, holders: userIds.length });
  }

  for (const userId of userIds) {
    if (capturedAlready.has(userId)) {
      result.alreadyCaptured += 1;
      continue;
    }

    try {
      const outcome = await captureDailySnapshot(userId, { date });
      if (outcome === "captured") result.captured += 1;
      else if (outcome === "already_captured") result.alreadyCaptured += 1;
      else result.nothingToRecord += 1;
    } catch (error) {
      result.failed += 1;
      log.error("portfolio.snapshot.failed", {
        date,
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  log.info("portfolio.snapshot.sweep.ok", { ...result, durationMs: Date.now() - startedAt });
  return result;
}
