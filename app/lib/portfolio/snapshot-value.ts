/**
 * What a portfolio was worth, computed from the positions view.
 *
 * Split out from the writer and kept free of database and network access so the
 * rule that matters — *what is allowed into a permanent history* — is a pure
 * function a test can pin down (`tests/portfolio-snapshots.test.ts`).
 *
 * It is deliberately stricter than `summarisePortfolio()`, which produces the
 * live total. That total may include a placeholder-priced holding because the
 * screen showing it also shows the badge saying so. A history point carries no
 * such context tomorrow: a fabricated number written into a series is
 * indistinguishable from an observed one forever after. So here a synthetic
 * holding is excluded and counted, and a day with nothing observable produces no
 * row at all — never a zero, never yesterday's value carried forward
 * (docs/synthetic-data-policy.md).
 */

import type { PortfolioPosition } from "@/app/lib/portfolio/portfolio-positions";

export type PortfolioValuation = {
  /** The display currency the totals are expressed in. Stored, not assumed. */
  currency: string;
  totalValue: number;
  /**
   * Cost basis across holdings whose cost we know, and the market value of
   * exactly those holdings, both in `currency`. Null together when no holding
   * has a known cost, so a return is either computable like-for-like or is not
   * computed at all.
   */
  costBasis: number | null;
  costedValue: number | null;
  /** Every holding the person had, including the ones left out of the total. */
  positionCount: number;
  /** How many of them `totalValue` actually covers. */
  valuedPositionCount: number;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Eligible for history: priced from a real feed, and convertible into the
 * display currency. A row with no FX rate is excluded rather than added at face
 * value, for the same reason the live total excludes it (ROADMAP §2.7).
 */
function isRecordable(position: PortfolioPosition): boolean {
  return (
    position.synthetic !== true &&
    position.valueInDisplayCurrency !== null &&
    Number.isFinite(position.valueInDisplayCurrency) &&
    position.valueInDisplayCurrency >= 0
  );
}

/**
 * The FX rate this row was actually converted at, recovered from the row itself.
 *
 * The cost basis is quoted per share in the holding's own currency and has to
 * reach the display currency to be comparable with the value. Re-fetching a rate
 * here would be both a second network call and a *different* rate from the one
 * the value used — the row already carries the answer, so it is read back off
 * the row instead.
 */
function impliedFxRate(position: PortfolioPosition): number | null {
  // positionValue is null when no live source could price the holding and
  // synthetic fallback is off. There is no rate to recover from a row that has
  // no value, and no snapshot should be written from one.
  if (position.valueInDisplayCurrency === null || position.positionValue === null) {
    return null;
  }
  if (!Number.isFinite(position.positionValue) || position.positionValue <= 0) {
    return null;
  }
  return position.valueInDisplayCurrency / position.positionValue;
}

/**
 * Values `positions` for the history table, or returns `null` when there is
 * nothing observed to record — no holdings, everything placeholder-priced, or no
 * FX rate for any of them. `null` means "write no row today", not "write a zero".
 */
export function computePortfolioValuation(
  positions: PortfolioPosition[],
  displayCurrency: string
): PortfolioValuation | null {
  const recordable = positions.filter(isRecordable);
  if (recordable.length === 0) {
    return null;
  }

  let costBasis = 0;
  let costedValue = 0;
  let costedCount = 0;
  for (const position of recordable) {
    const avgCost = position.avgCost;
    if (avgCost === null || !Number.isFinite(avgCost) || avgCost <= 0) {
      continue;
    }
    const rate = impliedFxRate(position);
    if (rate === null) {
      continue;
    }
    costBasis += position.shares * avgCost * rate;
    costedValue += position.valueInDisplayCurrency as number;
    costedCount += 1;
  }

  return {
    currency: displayCurrency.trim().toUpperCase(),
    totalValue: roundMoney(recordable.reduce((acc, row) => acc + (row.valueInDisplayCurrency as number), 0)),
    costBasis: costedCount > 0 ? roundMoney(costBasis) : null,
    costedValue: costedCount > 0 ? roundMoney(costedValue) : null,
    positionCount: positions.length,
    valuedPositionCount: recordable.length
  };
}
