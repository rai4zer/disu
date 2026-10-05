/**
 * Minimum price increments — the step an arrow on a limit price may take.
 *
 * A limit price is not a free decimal. Every venue publishes a tick ladder, and
 * a price off the ladder is rejected before it reaches the book. So the arrows
 * on the order ticket step by the instrument's tick rather than by a made-up
 * 0.01, and a typed price is snapped onto the ladder rather than sent as typed.
 *
 * Two regimes, because the two rules are genuinely different:
 *
 * - **`us`** — SEC Rule 612: one cent at or above $1.00, one hundredth of a
 *   cent below it. Flat, and not a function of liquidity.
 * - **`eu`** — MiFID II RTS 11: a table of twenty price bands by six liquidity
 *   bands, where the liquidity band comes from the instrument's average daily
 *   number of transactions.
 *
 * Pure and dependency-free, the same discipline as `order-state.ts`: no I/O, no
 * clock, no database. That is what makes the ladder testable exhaustively
 * (`tests/trading-tick-size.test.ts`).
 *
 * **Two caveats that must be closed before this prices a real order.** Neither
 * matters while `docs/trading-platform.md` §5 is unmet and nothing routes, but
 * both are real:
 *
 * 1. The RTS 11 table below is transcribed, not fetched. Before a live order is
 *    ever priced by it, check it against the Official Journal — and better,
 *    replace it with the venue's published tick, which the partner connection
 *    will carry. A tick table is the venue's to state, not ours to remember.
 * 2. `ASSUMED_LIQUIDITY_BAND` is an assumption, and it is the weak point. See
 *    its comment.
 */

/** Which rulebook sets the increment. */
export type TickRegime = "us" | "eu";

/**
 * RTS 11 liquidity band, from the instrument's average daily number of
 * transactions: 1 is `ADNT < 10`, 6 is `ADNT >= 9000`. More liquid means a
 * finer tick.
 */
export type LiquidityBand = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * The band used when nothing has told us the real one — which today is always,
 * because ADNT is not in any feed DISU reads.
 *
 * **This is an assumption.** Band 6 is `ADNT >= 9000`, and it is chosen because
 * it is the one that can be checked: at band 6 the table returns the tick these
 * instruments are actually quoted at — 0.10 for ASML around EUR 600, 0.05 for
 * Volvo B around SEK 350 — which is pinned in `tests/trading-tick-size.test.ts`.
 * An OMXS30 or EURO STOXX constituent, which is what a retail reader opens
 * these pages for, sits in this band.
 *
 * It is wrong for a small cap, where the true tick is coarser: the arrow will
 * then offer a price finer than the venue accepts. That is the failure mode to
 * remember, and the reason this is a placeholder for a number we will be given
 * rather than one we derived. The partner connection carries the venue's own
 * tick per instrument, and this constant should stop being read at all.
 */
export const ASSUMED_LIQUIDITY_BAND: LiquidityBand = 6;

/**
 * Everything here is integer arithmetic in units of 0.0001 — "pips" — because
 * the finest increment either regime defines is 0.0001 and because 0.1 + 0.2 is
 * not 0.3 in IEEE-754. Same reason `types.ts` refuses `number` for money.
 */
const PIP = 10_000;

/**
 * The 1-2-5 ladder every tick in either regime is drawn from, in pips:
 * 0.0001, 0.0002, 0.0005, 0.001 … 1000.
 */
const LADDER = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000,
  500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000
] as const;

/**
 * RTS 11's twenty price bands, as exclusive upper bounds in pips. A price at or
 * above the last bound falls in the final band.
 */
const PRICE_BANDS = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000,
  100_000
].map((bound) => bound * PIP);

/**
 * The RTS 11 table is a diagonal: within a price band, each step up in
 * liquidity is one step finer on the ladder, and it floors at 0.0001. Encoding
 * the structure rather than 120 transcribed cells is what makes it checkable —
 * the property is one line to verify against the Official Journal, where a
 * mistyped cell in the middle of a literal is not.
 *
 * The anchor: price band 0 (below 0.1) at liquidity band 1 is 0.0005, which is
 * ladder index 2.
 */
const BAND_1_LADDER_OFFSET = 2;

function ladderIndex(priceBandIndex: number, liquidityBand: LiquidityBand): number {
  const index = priceBandIndex + BAND_1_LADDER_OFFSET - (liquidityBand - 1);
  // Clamped at both ends: the table floors at 0.0001 for the most liquid names,
  // and the top band's coarsest tick is the last rung.
  return Math.min(LADDER.length - 1, Math.max(0, index));
}

function priceBandIndex(pricePips: number): number {
  for (let index = 0; index < PRICE_BANDS.length; index += 1) {
    if (pricePips < PRICE_BANDS[index]) return index;
  }
  return PRICE_BANDS.length;
}

/**
 * The regime a symbol trades under, from the Yahoo-style exchange suffix — the
 * same convention `inferCurrencyFromTicker()` reads.
 *
 * An *inference*, like that one, and it fails to `us` because an unsuffixed
 * symbol is a US listing under that convention. It is not a substitute for the
 * venue telling us its tick.
 */
export function tickRegimeForSymbol(rawSymbol: string): TickRegime {
  const suffix = rawSymbol.trim().toUpperCase().split(".")[1] ?? "";
  if (!suffix) return "us";
  // Nordics, the euro area, Switzerland and London all sit under RTS 11 or, for
  // London, a post-Brexit regime that kept the same ladder.
  const EU_SUFFIXES = ["ST", "CO", "OL", "HE", "SW", "PA", "AS", "DE", "MI", "BR", "VI", "LS", "MC", "IR", "L"];
  return EU_SUFFIXES.includes(suffix) ? "eu" : "us";
}

/**
 * The minimum increment at `price`, in whole pips.
 *
 * Returns null for a price that is not a finite positive number — a tick for a
 * price we do not have is not a thing to guess.
 */
export function tickSizePips(
  price: number,
  regime: TickRegime,
  liquidityBand: LiquidityBand = ASSUMED_LIQUIDITY_BAND
): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const pricePips = Math.round(price * PIP);

  if (regime === "us") {
    // SEC Rule 612. The 2024 amendment adds a half-cent tick for stocks the SEC
    // designates as tick-constrained; that designation is per-stock and is not
    // in any feed we read, so it is deliberately not guessed at here.
    return pricePips >= PIP ? 100 : 1;
  }

  return LADDER[ladderIndex(priceBandIndex(pricePips), liquidityBand)];
}

/** The minimum increment at `price`, as a decimal. Null when there is no price. */
export function tickSize(
  price: number,
  regime: TickRegime,
  liquidityBand: LiquidityBand = ASSUMED_LIQUIDITY_BAND
): number | null {
  const pips = tickSizePips(price, regime, liquidityBand);
  return pips === null ? null : pips / PIP;
}

/**
 * Move `price` one tick in `direction`, landing on the ladder.
 *
 * A price already on the ladder moves exactly one tick. A price between two
 * rungs — someone typed it — moves to the next rung in that direction rather
 * than to an equally invalid neighbour, which is why this snaps rather than
 * adding. Never returns a non-positive price: stepping down from the first tick
 * holds there instead of crossing zero.
 *
 * The tick is read at the price being left. Crossing a price-band boundary
 * therefore takes one step at the old band's tick, and the next step uses the
 * new one — the same way a venue's own ladder behaves.
 */
export function stepPrice(
  price: number,
  direction: 1 | -1,
  regime: TickRegime,
  liquidityBand: LiquidityBand = ASSUMED_LIQUIDITY_BAND
): number | null {
  const tick = tickSizePips(price, regime, liquidityBand);
  if (tick === null) return null;

  const pricePips = Math.round(price * PIP);
  const onLadder = pricePips % tick === 0;

  const nextPips = onLadder
    ? pricePips + direction * tick
    : direction === 1
      ? Math.ceil(pricePips / tick) * tick
      : Math.floor(pricePips / tick) * tick;

  return nextPips <= 0 ? tick / PIP : nextPips / PIP;
}

/** The nearest valid price at or below `price`. Used to seed an empty field. */
export function snapPrice(
  price: number,
  regime: TickRegime,
  liquidityBand: LiquidityBand = ASSUMED_LIQUIDITY_BAND
): number | null {
  const tick = tickSizePips(price, regime, liquidityBand);
  if (tick === null) return null;
  const snapped = Math.floor(Math.round(price * PIP) / tick) * tick;
  return (snapped <= 0 ? tick : snapped) / PIP;
}

/** How many decimals a tick needs, so a stepped price renders exactly. */
export function tickDecimals(tick: number): number {
  const pips = Math.round(tick * PIP);
  if (pips % PIP === 0) return 0;
  if (pips % 1_000 === 0) return 1;
  if (pips % 100 === 0) return 2;
  if (pips % 10 === 0) return 3;
  return 4;
}
