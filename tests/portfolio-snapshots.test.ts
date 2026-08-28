import assert from "node:assert/strict";
import test from "node:test";

import { startFakeSupabase, type FakeSupabase } from "./support/fake-supabase.ts";
import { toComparableSeries, type StoredSnapshot } from "@/app/lib/portfolio/history-series";
import { computePortfolioValuation } from "@/app/lib/portfolio/snapshot-value";
import type { PortfolioPosition } from "@/app/lib/portfolio/portfolio-positions";

/**
 * Daily portfolio history (migration 0021, ROADMAP §5.1).
 *
 * The property under test is not "a row was written" but *which* days are
 * allowed to exist. History is written once and read for years, and a reader
 * looking at a point on a chart in 2027 has no way to tell an observed value
 * from an invented one — so a day the market could not be observed has to be a
 * gap, and a placeholder-priced holding has to be left out of the total and
 * counted, never folded in (docs/synthetic-data-policy.md).
 */

const ALICE = "usr_alice";
const BOB = "usr_bob";
const NOW = "2026-08-27T09:00:00.000Z";
const TODAY = "2026-08-27";

function position(overrides: Partial<PortfolioPosition> = {}): PortfolioPosition {
  const base: PortfolioPosition = {
    id: "pos_1",
    source: "broker",
    ticker: "ERIC-B.ST",
    symbol: "ERIC-B.ST",
    name: "Ericsson",
    shares: 10,
    quantity: 10,
    avgCost: null,
    currentPrice: 70,
    positionValue: 700,
    marketValue: 700,
    unrealizedPnl: null,
    accountType: null,
    broker: "avanza",
    currency: "SEK",
    asOf: NOW,
    connectionId: "conn_1",
    previousClose: null,
    dayChangePct: null,
    dayChangeAmount: null,
    priceSource: "broker",
    synthetic: false,
    valueInDisplayCurrency: 700
  };
  return { ...base, ...overrides };
}

test("a placeholder-priced holding is left out of the total and counted, not folded in", () => {
  const valuation = computePortfolioValuation(
    [
      position({ id: "a", valueInDisplayCurrency: 700 }),
      position({ id: "b", synthetic: true, priceSource: "placeholder", valueInDisplayCurrency: 5_000 })
    ],
    "SEK"
  );

  assert.ok(valuation);
  assert.equal(valuation.totalValue, 700, "the invented 5 000 must not reach the history table");
  assert.equal(valuation.positionCount, 2);
  assert.equal(valuation.valuedPositionCount, 1, "the reader has to be able to see the total is partial");
});

test("a holding with no FX rate is excluded rather than added at face value", () => {
  const valuation = computePortfolioValuation(
    [
      position({ id: "a", valueInDisplayCurrency: 700 }),
      position({ id: "b", currency: "USD", positionValue: 300, marketValue: 300, valueInDisplayCurrency: null })
    ],
    "SEK"
  );

  assert.ok(valuation);
  assert.equal(valuation.totalValue, 700, "300 USD is not 300 SEK");
  assert.equal(valuation.valuedPositionCount, 1);
});

test("a holding no feed could price is excluded, never recorded as worth nothing", () => {
  // priceSource "unavailable" is what production looks like: with synthetic
  // fallback off there is no placeholder to catch, just a holding with no price.
  const unpriceable = position({
    id: "b",
    priceSource: "unavailable",
    currentPrice: null,
    positionValue: null,
    marketValue: null,
    valueInDisplayCurrency: null
  });

  const valuation = computePortfolioValuation([position({ id: "a", valueInDisplayCurrency: 700 }), unpriceable], "SEK");
  assert.ok(valuation);
  assert.equal(valuation.totalValue, 700, "an unpriceable holding is not a holding worth 0");
  assert.equal(valuation.positionCount, 2);
  assert.equal(valuation.valuedPositionCount, 1);

  assert.equal(
    computePortfolioValuation([unpriceable], "SEK"),
    null,
    "a portfolio nothing could price is a gap in the series"
  );
});

test("a day with nothing observable produces no row at all — never a zero", () => {
  assert.equal(computePortfolioValuation([], "SEK"), null);
  assert.equal(
    computePortfolioValuation([position({ synthetic: true, priceSource: "placeholder" })], "SEK"),
    null,
    "an all-placeholder portfolio is a gap in the series, not a portfolio worth 0"
  );
  assert.equal(
    computePortfolioValuation([position({ valueInDisplayCurrency: null })], "SEK"),
    null
  );
});

test("cost basis is converted at the rate its own row was valued with", () => {
  // 4 shares at $100, valued at 4 400 SEK — an implied 11.00 SEK/USD, which the
  // cost basis has to use too or the return is computed across two currencies.
  const valuation = computePortfolioValuation(
    [
      position({
        id: "usd",
        currency: "USD",
        shares: 4,
        avgCost: 100,
        positionValue: 400,
        marketValue: 400,
        valueInDisplayCurrency: 4_400
      })
    ],
    "SEK"
  );

  assert.ok(valuation);
  assert.equal(valuation.costBasis, 4_400);
  assert.equal(valuation.costedValue, 4_400);
});

test("cost basis covers only the holdings whose cost is known, paired with their own value", () => {
  const valuation = computePortfolioValuation(
    [
      position({ id: "costed", avgCost: 50, shares: 10, positionValue: 700, marketValue: 700, valueInDisplayCurrency: 700 }),
      position({ id: "uncosted", avgCost: null, positionValue: 300, marketValue: 300, valueInDisplayCurrency: 300 })
    ],
    "SEK"
  );

  assert.ok(valuation);
  assert.equal(valuation.totalValue, 1_000);
  assert.equal(valuation.costBasis, 500);
  assert.equal(valuation.costedValue, 700, "the value paired with the cost, not the whole portfolio");
});

test("no known cost anywhere leaves the pair null rather than implying a break-even", () => {
  const valuation = computePortfolioValuation([position({ avgCost: null })], "SEK");
  assert.ok(valuation);
  assert.equal(valuation.costBasis, null);
  assert.equal(valuation.costedValue, null);
});

/* ------------------------------------------------------------------ writer */

function seed() {
  const connection = (id: string, userId: string) => ({
    id,
    user_id: userId,
    broker: "avanza",
    status: "connected",
    auth_provider: "manual",
    data_scope: "positions_plus",
    external_account_id: null,
    consent_expires_at: null,
    last_synced_at: null,
    error_code: null,
    created_at: NOW,
    updated_at: NOW
  });

  return {
    broker_connections: [connection("conn_alice", ALICE), connection("conn_bob", BOB)],
    positions: [
      { id: "pos_alice", user_id: ALICE, connection_id: "conn_alice", symbol: "ERIC-B.ST", isin: "SE1", name: "Ericsson", quantity: 10, avg_cost: 60, currency: "SEK", market_value: 700, as_of: NOW },
      { id: "pos_bob", user_id: BOB, connection_id: "conn_bob", symbol: "VOLV-B.ST", isin: "SE2", name: "Volvo", quantity: 5, avg_cost: 250, currency: "SEK", market_value: 1_400, as_of: NOW }
    ],
    manual_positions: [],
    portfolio_snapshots: []
  };
}

async function withDb(run: (db: FakeSupabase) => Promise<void>): Promise<void> {
  const db = await startFakeSupabase(seed());
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousCurrency = process.env.PORTFOLIO_DISPLAY_CURRENCY;
  process.env.SUPABASE_URL = db.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  // Everything seeded is already in the display currency, so no FX lookup —
  // and therefore no network — happens inside these tests.
  process.env.PORTFOLIO_DISPLAY_CURRENCY = "SEK";
  process.env.DISU_SESSION_SECRET ??= "test-session-secret-0123456789";
  process.env.BROKER_TOKEN_ENCRYPTION_KEY ??= "a".repeat(64);
  process.env.QUANT_PYTHON_BIN ??= "/bin/sh";
  process.env.PRIMER_PYTHON_BIN ??= "/bin/sh";

  try {
    await run(db);
  } finally {
    await db.close();
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    if (previousCurrency === undefined) delete process.env.PORTFOLIO_DISPLAY_CURRENCY;
    else process.env.PORTFOLIO_DISPLAY_CURRENCY = previousCurrency;
  }
}

test("capture writes one dated row owned by the person it valued", async () => {
  await withDb(async (db) => {
    const snapshots = await import("@/app/lib/portfolio/snapshots");

    assert.equal(await snapshots.captureDailySnapshot(ALICE, { date: TODAY }), "captured");

    const rows = db.rowsIn("portfolio_snapshots");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, ALICE);
    assert.equal(rows[0].snapshot_date, TODAY);
    assert.equal(rows[0].currency, "SEK");
    assert.equal(rows[0].total_value, 700);
    assert.equal(rows[0].cost_basis, 600);
    assert.equal(rows[0].position_count, 1);
    assert.equal(rows[0].valued_position_count, 1);
    assert.ok(rows[0].captured_at, "captured_at says where in the day the reading was taken");
  });
});

test("the first capture of a day wins — a re-run does not overwrite or duplicate it", async () => {
  await withDb(async (db) => {
    const snapshots = await import("@/app/lib/portfolio/snapshots");

    await snapshots.captureDailySnapshot(ALICE, { date: TODAY });
    assert.equal(await snapshots.captureDailySnapshot(ALICE, { date: TODAY }), "already_captured");
    assert.equal(db.rowsIn("portfolio_snapshots").length, 1);
  });
});

test("the sweep values every holder exactly once and keeps them apart", async () => {
  await withDb(async (db) => {
    const snapshots = await import("@/app/lib/portfolio/snapshots");

    const first = await snapshots.runDailySnapshotSweep({ date: TODAY });
    assert.equal(first.holders, 2);
    assert.equal(first.captured, 2);
    assert.equal(first.failed, 0);

    const rows = db.rowsIn("portfolio_snapshots");
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => [row.user_id, row.total_value]).sort(),
      [[ALICE, 700], [BOB, 1_400]].sort()
    );

    // A second sweep the same day is a no-op, and costs one query rather than
    // re-valuing everybody.
    const second = await snapshots.runDailySnapshotSweep({ date: TODAY });
    assert.equal(second.captured, 0);
    assert.equal(second.alreadyCaptured, 2);
    assert.equal(db.rowsIn("portfolio_snapshots").length, 2);
  });
});

test("a person's own snapshots are the only ones they can read", async () => {
  await withDb(async (db) => {
    const snapshots = await import("@/app/lib/portfolio/snapshots");

    await snapshots.runDailySnapshotSweep({ date: TODAY });
    const alicesRows = await snapshots.listPortfolioSnapshots(ALICE);

    assert.equal(alicesRows.length, 1);
    assert.equal(alicesRows[0].user_id, ALICE);

    // The scope has to be on the wire, not merely reflected in the result: a
    // reader that filtered in JS would pass the assertion above and still have
    // pulled Bob's row across the network.
    const read = db.requests.filter((request) => request.table === "portfolio_snapshots" && request.method === "GET");
    const scoped = read.filter((request) => request.query.user_id === `eq.${ALICE}`);
    assert.ok(scoped.length > 0);
    assert.equal(scoped[scoped.length - 1].query.user_id, `eq.${ALICE}`);
  });
});

/* ------------------------------------------------------------------ reader */

/**
 * What the dashboard chart is allowed to draw from what was stored.
 *
 * The reader has the mirror-image duty of the writer: the writer refuses to
 * record a day it could not observe, and the reader refuses to join days that
 * are not comparable. A history whose unit changed halfway would otherwise show
 * a jump the portfolio never made.
 */

function stored(date: string, value: number, currency = "SEK"): StoredSnapshot {
  return {
    snapshot_date: date,
    captured_at: `${date}T09:00:00.000Z`,
    currency,
    total_value: value,
    cost_basis: null,
    costed_value: null,
    position_count: 1,
    valued_position_count: 1
  };
}

test("the series is returned oldest first, whatever order the store handed back", () => {
  const series = toComparableSeries([
    stored("2026-08-03", 300),
    stored("2026-08-01", 100),
    stored("2026-08-02", 200)
  ]);

  assert.deepEqual(
    series.points.map((point) => point.date),
    ["2026-08-01", "2026-08-02", "2026-08-03"]
  );
  assert.equal(series.currency, "SEK");
});

test("history is cut where its currency changes, and the cut is reported", () => {
  const series = toComparableSeries([
    stored("2026-08-01", 100, "USD"),
    stored("2026-08-02", 110, "USD"),
    stored("2026-08-03", 1_050, "SEK"),
    stored("2026-08-04", 1_070, "SEK")
  ]);

  // Only the trailing run in the newest currency is comparable. The USD days
  // are not converted and not joined on — they are dropped and counted.
  assert.equal(series.currency, "SEK");
  assert.deepEqual(
    series.points.map((point) => point.date),
    ["2026-08-03", "2026-08-04"]
  );
  assert.equal(series.droppedForCurrencyChange, 2);
});

test("a missing day stays missing — the reader never fills a gap", () => {
  const series = toComparableSeries([stored("2026-08-01", 100), stored("2026-08-05", 140)]);

  assert.deepEqual(
    series.points.map((point) => point.date),
    ["2026-08-01", "2026-08-05"]
  );
  assert.equal(series.points.length, 2, "no value is invented for 2026-08-02 through 04");
});

test("no history is an empty series, not a zero-valued point", () => {
  const series = toComparableSeries([]);

  assert.deepEqual(series.points, []);
  assert.equal(series.currency, null);
  assert.equal(series.droppedForCurrencyChange, 0);
});
