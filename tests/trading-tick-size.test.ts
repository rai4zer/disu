import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSUMED_LIQUIDITY_BAND,
  snapPrice,
  stepPrice,
  tickDecimals,
  tickRegimeForSymbol,
  tickSize
} from "../app/lib/trading/tick-size.ts";
import type { LiquidityBand } from "../app/lib/trading/tick-size.ts";

// The ladders in app/lib/trading/tick-size.ts, pinned. The module is pure, so
// the rules can be tested against the published tables rather than a venue.

test("US ticks follow Rule 612: a cent at and above $1, a hundredth below", () => {
  assert.equal(tickSize(0.9999, "us"), 0.0001);
  assert.equal(tickSize(0.5, "us"), 0.0001);
  assert.equal(tickSize(1, "us"), 0.01);
  assert.equal(tickSize(319.97, "us"), 0.01);
  assert.equal(tickSize(100_000, "us"), 0.01);
});

test("US ticks do not vary with the liquidity band", () => {
  for (const band of [1, 2, 3, 4, 5, 6] as LiquidityBand[]) {
    assert.equal(tickSize(250, "us", band), 0.01);
  }
});

// Cells read off the RTS 11 table. Chosen to cover both ends of the diagonal
// and the 0.0001 floor, which is where an off-by-one in the shift would show.
const RTS11_CELLS: Array<{ price: number; band: LiquidityBand; tick: number }> = [
  { price: 0.05, band: 1, tick: 0.0005 },
  { price: 0.05, band: 6, tick: 0.0001 },
  { price: 0.15, band: 1, tick: 0.001 },
  { price: 1.5, band: 1, tick: 0.01 },
  { price: 1.5, band: 6, tick: 0.0002 },
  { price: 30, band: 1, tick: 0.2 },
  { price: 30, band: 5, tick: 0.01 },
  { price: 30, band: 6, tick: 0.005 },
  { price: 150, band: 6, tick: 0.02 },
  { price: 280.5, band: 5, tick: 0.1 },
  { price: 1_500, band: 1, tick: 10 },
  { price: 250_000, band: 1, tick: 1_000 }
];

test("RTS 11 cells match the published table", () => {
  for (const cell of RTS11_CELLS) {
    assert.equal(
      tickSize(cell.price, "eu", cell.band),
      cell.tick,
      `price ${cell.price} in liquidity band ${cell.band}`
    );
  }
});

// Corroboration from outside the table: two names whose quoted tick is public
// and stable. A transcription slip in the diagonal shows up here as a tick that
// does not match what the venue actually displays.
test("liquid large caps get the tick their venue actually quotes", () => {
  // ASML around EUR 600 quotes in 0.10.
  assert.equal(tickSize(612.4, "eu", 6), 0.1);
  // Volvo B around SEK 280 quotes in 0.05.
  assert.equal(tickSize(280.5, "eu", 6), 0.05);
});

test("a more liquid band is never a coarser tick", () => {
  for (const price of [0.05, 0.3, 1.5, 7, 30, 150, 900, 40_000]) {
    for (const band of [2, 3, 4, 5, 6] as LiquidityBand[]) {
      const finer = tickSize(price, "eu", band);
      const coarser = tickSize(price, "eu", (band - 1) as LiquidityBand);
      assert.ok(finer !== null && coarser !== null);
      assert.ok(finer <= coarser, `band ${band} must not be coarser than ${band - 1} at ${price}`);
    }
  }
});

test("a price without a number has no tick, rather than a guessed one", () => {
  assert.equal(tickSize(0, "eu"), null);
  assert.equal(tickSize(-5, "eu"), null);
  assert.equal(tickSize(Number.NaN, "us"), null);
  assert.equal(stepPrice(Number.NaN, 1, "us"), null);
});

test("a price on the ladder steps exactly one tick", () => {
  assert.equal(stepPrice(319.97, 1, "us"), 319.98);
  assert.equal(stepPrice(319.97, -1, "us"), 319.96);
  // 280.5 sits in the 200-500 band, band 5: a 0.1 tick.
  assert.equal(stepPrice(280.5, 1, "eu", 5), 280.6);
  assert.equal(stepPrice(280.5, -1, "eu", 5), 280.4);
});

test("a typed price between two rungs snaps to the next rung, not past it", () => {
  // 280.54 is off the 0.1 ladder. Up is 280.6 and down is 280.5 — neither is
  // 280.54 +/- 0.1, which would land off the ladder again.
  assert.equal(stepPrice(280.54, 1, "eu", 5), 280.6);
  assert.equal(stepPrice(280.54, -1, "eu", 5), 280.5);
});

test("stepping down never crosses zero", () => {
  // Sub-dollar prices step by a hundredth of a cent, so this is one tick down.
  assert.equal(stepPrice(0.01, -1, "us"), 0.0099);
  // And the first rung holds rather than stepping to zero or below.
  assert.equal(stepPrice(0.0001, -1, "us"), 0.0001);
});

test("stepping repeatedly stays exact where floating point would drift", () => {
  let price = 1.01;
  for (let i = 0; i < 100; i += 1) {
    price = stepPrice(price, 1, "us") as number;
  }
  // 1.01 plus 100 cents. Naive repeated addition of 0.01 lands on 2.0099999999999976.
  assert.equal(price, 2.01);
});

test("snapping seeds an empty field with a price the venue would accept", () => {
  assert.equal(snapPrice(280.54, "eu", 5), 280.5);
  assert.equal(snapPrice(319.9741, "us"), 319.97);
});

test("the regime is inferred from the exchange suffix", () => {
  assert.equal(tickRegimeForSymbol("AAPL"), "us");
  assert.equal(tickRegimeForSymbol("BRK-B"), "us");
  assert.equal(tickRegimeForSymbol("VOLV-B.ST"), "eu");
  assert.equal(tickRegimeForSymbol("novo-b.co"), "eu");
  assert.equal(tickRegimeForSymbol("SHEL.L"), "eu");
  assert.equal(tickRegimeForSymbol("7203.T"), "us", "an unmapped suffix falls back rather than throwing");
});

test("tick decimals render a stepped price exactly", () => {
  assert.equal(tickDecimals(1), 0);
  assert.equal(tickDecimals(0.5), 1);
  assert.equal(tickDecimals(0.01), 2);
  assert.equal(tickDecimals(0.002), 3);
  assert.equal(tickDecimals(0.0005), 4);
  const tick = tickSize(280.5, "eu", 5) as number;
  assert.equal((280.6).toFixed(tickDecimals(tick)), "280.6");
});

test("the assumed liquidity band is what the default argument uses", () => {
  assert.equal(tickSize(30, "eu"), tickSize(30, "eu", ASSUMED_LIQUIDITY_BAND));
  // And it is the band whose ticks match what these venues actually quote, which
  // is the whole justification for picking it. See the constant's comment.
  assert.equal(tickSize(612.4, "eu"), 0.1);
  assert.equal(tickSize(348.5, "eu"), 0.05);
});
