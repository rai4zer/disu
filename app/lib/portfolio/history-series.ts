/**
 * What a stored portfolio history is allowed to be drawn as.
 *
 * Split out from the route and kept free of database and network access for the
 * same reason `snapshot-value.ts` is: the rule that matters — *which stored days
 * may be joined into one line* — is a pure function a test can pin down
 * (`tests/portfolio-snapshots.test.ts`).
 *
 * The rule is the one migration 0021 states. `portfolio_snapshots.currency` is
 * stored per row because `PORTFOLIO_DISPLAY_CURRENCY` is configuration and
 * configuration changes; a series whose unit silently changed halfway is worse
 * than one with a visible break in it, because the reader sees a jump that the
 * portfolio never made. So a reader gets only the trailing run in the newest
 * currency, and is told how many older rows were cut off rather than having them
 * quietly folded in (docs/synthetic-data-policy.md).
 *
 * Nothing else is transformed. Gaps are left as gaps: a day with no row is a day
 * nothing could be observed, and it is the chart's job to break its line there,
 * not this function's job to invent a value for it.
 */

export type StoredSnapshot = {
  snapshot_date: string;
  captured_at: string;
  currency: string;
  total_value: number;
  cost_basis: number | null;
  costed_value: number | null;
  position_count: number;
  valued_position_count: number;
};

export type PortfolioHistoryPoint = {
  date: string;
  capturedAt: string;
  value: number;
  /** Cost basis and the market value of exactly the holdings it covers. */
  costBasis: number | null;
  costedValue: number | null;
  positionCount: number;
  valuedPositionCount: number;
};

export type PortfolioHistorySeries = {
  /** null only when there is no history at all. */
  currency: string | null;
  /** Oldest first, comparable with each other, gaps left intact. */
  points: PortfolioHistoryPoint[];
  /** Rows cut off because they were recorded in a different currency. */
  droppedForCurrencyChange: number;
};

export function toComparableSeries(rows: StoredSnapshot[]): PortfolioHistorySeries {
  if (rows.length === 0) {
    return { currency: null, points: [], droppedForCurrencyChange: 0 };
  }

  // The store orders newest first; a chart reads left to right.
  const ordered = rows.slice().sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

  const currency = ordered[ordered.length - 1].currency;
  let start = ordered.length;
  while (start > 0 && ordered[start - 1].currency === currency) {
    start -= 1;
  }
  const comparable = ordered.slice(start);

  return {
    currency,
    points: comparable.map((row) => ({
      date: row.snapshot_date,
      capturedAt: row.captured_at,
      value: row.total_value,
      costBasis: row.cost_basis,
      costedValue: row.costed_value,
      positionCount: row.position_count,
      valuedPositionCount: row.valued_position_count
    })),
    droppedForCurrencyChange: ordered.length - comparable.length
  };
}
