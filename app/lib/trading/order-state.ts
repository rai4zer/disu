/**
 * The order lifecycle, as pure functions.
 *
 * This is the first piece of the trading work written, on purpose: it is the
 * only part that can be made correct before a partner exists, and it is where
 * the expensive mistakes live. Every rule below is here because the alternative
 * is a way to lose a customer's money or misreport their position.
 *
 * Nothing in this module performs I/O, reads a clock or touches a database. It
 * takes an order and an event and returns the next order, or an explanation of
 * why the event does not apply. That makes the rules testable exhaustively
 * (`tests/trading-order-state.test.ts`) rather than by integration against a
 * sandbox that is up on some days.
 *
 * Quantities are decimal strings (see `types.ts` on why money is never a
 * `number`). The comparisons here go through `compareDecimal`, which is
 * integer-based and exact for the scale we accept — deliberately not
 * `parseFloat`, which is the bug this whole convention exists to prevent.
 */

import type { Order, OrderStatus } from "./types";

/**
 * The permitted transitions.
 *
 * The four terminal states map to empty arrays rather than being absent, so
 * "terminal" is a property of the table itself: a late webhook arriving after a
 * fill cannot resurrect the order, because there is nowhere for it to go.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ["pending", "cancelled"],
  pending: ["working", "rejected", "cancelled"],
  working: ["partially_filled", "filled", "cancelled", "expired", "rejected"],
  partially_filled: ["partially_filled", "filled", "cancelled", "expired"],
  filled: [],
  cancelled: [],
  rejected: [],
  expired: []
};

export const TERMINAL_STATUSES: readonly OrderStatus[] = ["filled", "cancelled", "rejected", "expired"];

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * The outcome of applying an event.
 *
 * A refusal is a value, not an exception, and it carries a machine-readable
 * `reason`. Partner webhooks deliver out of order as a matter of course, so
 * "this does not apply" is an ordinary, expected answer that the caller logs
 * and drops — not an error path.
 */
export type TransitionResult =
  | { ok: true; order: Order }
  | { ok: false; reason: TransitionRefusal };

export type TransitionRefusal =
  | "terminal"
  | "illegal_transition"
  | "overfill"
  | "non_monotonic_fill"
  | "invalid_quantity";

// --- decimal helpers --------------------------------------------------------

/**
 * Exact comparison and addition for decimal strings, done on scaled integers.
 *
 * `parseFloat` would be one line and wrong: 0.1 + 0.2 is not 0.3 in binary
 * floating point, and an order that fills in thirds would never reach exactly
 * its quantity — so a fully filled order would sit in `partially_filled`
 * forever, and the position would be understated.
 *
 * `BigInt` rather than a dependency, because the operations needed here are
 * comparison and addition and nothing else.
 */
const MAX_SCALE = 8;

function toScaledInt(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const negative = trimmed.startsWith("-");
  const [whole, fraction = ""] = (negative ? trimmed.slice(1) : trimmed).split(".");
  if (fraction.length > MAX_SCALE) {
    return null;
  }
  const scaled = BigInt(whole + fraction.padEnd(MAX_SCALE, "0"));
  return negative ? -scaled : scaled;
}

function fromScaledInt(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(MAX_SCALE + 1, "0");
  const whole = digits.slice(0, -MAX_SCALE);
  const fraction = digits.slice(-MAX_SCALE).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** -1, 0 or 1. Null when either side is not a decimal we accept. */
export function compareDecimal(left: string, right: string): -1 | 0 | 1 | null {
  const a = toScaledInt(left);
  const b = toScaledInt(right);
  if (a === null || b === null) return null;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addDecimal(left: string, right: string): string | null {
  const a = toScaledInt(left);
  const b = toScaledInt(right);
  if (a === null || b === null) return null;
  return fromScaledInt(a + b);
}

// --- transitions ------------------------------------------------------------

/**
 * Move an order to a new status, without recording a fill.
 *
 * Used for the states the partner reports that are not executions: accepted,
 * rejected, cancelled, expired.
 */
export function applyStatus(order: Order, next: OrderStatus, at: string): TransitionResult {
  if (isTerminal(order.status)) {
    // Not an error. A cancel confirmation arriving after the fill that beat it
    // is normal; the order is simply already finished.
    return { ok: false, reason: "terminal" };
  }
  if (!canTransition(order.status, next)) {
    return { ok: false, reason: "illegal_transition" };
  }
  return { ok: true, order: { ...order, status: next, updatedAt: at } };
}

/**
 * Record an execution against an order.
 *
 * The three guards, in the order they can bite:
 *
 * 1. **A fill must be a positive quantity.** A zero-quantity fill is a partner
 *    bug that would otherwise flip a `working` order to `partially_filled`
 *    without moving anything.
 * 2. **Fills accumulate and never exceed the order.** An over-fill means the
 *    customer has been given a position they did not order. It must surface as
 *    a refusal an operator investigates, not as a silently clamped number.
 * 3. **Terminal is terminal**, as everywhere else.
 *
 * The status that comes out is derived from the arithmetic — filled when the
 * accumulated quantity equals the order quantity, partially filled below that —
 * rather than taken from the partner. A partner that says "filled" while
 * reporting less than the full quantity is a discrepancy worth catching.
 */
export function applyFill(
  order: Order,
  fill: { quantity: string; price: string; at: string }
): TransitionResult {
  if (isTerminal(order.status)) {
    return { ok: false, reason: "terminal" };
  }

  const positive = compareDecimal(fill.quantity, "0");
  if (positive === null || positive <= 0) {
    return { ok: false, reason: "invalid_quantity" };
  }
  if (compareDecimal(fill.price, "0") === null) {
    return { ok: false, reason: "invalid_quantity" };
  }

  const nextFilled = addDecimal(order.filledQuantity, fill.quantity);
  if (nextFilled === null) {
    return { ok: false, reason: "invalid_quantity" };
  }

  // Monotonic by construction above, but assert it: if this ever fails, the
  // stored order has been mutated by something that is not this module.
  if (compareDecimal(nextFilled, order.filledQuantity) === -1) {
    return { ok: false, reason: "non_monotonic_fill" };
  }

  const versusOrder = compareDecimal(nextFilled, order.quantity);
  if (versusOrder === null) {
    return { ok: false, reason: "invalid_quantity" };
  }
  if (versusOrder === 1) {
    return { ok: false, reason: "overfill" };
  }

  const nextStatus: OrderStatus = versusOrder === 0 ? "filled" : "partially_filled";
  if (!canTransition(order.status, nextStatus)) {
    return { ok: false, reason: "illegal_transition" };
  }

  return {
    ok: true,
    order: {
      ...order,
      status: nextStatus,
      filledQuantity: nextFilled,
      averageFillPrice: weightedAverage(order, fill),
      updatedAt: fill.at
    }
  };
}

/**
 * Quantity-weighted average fill price.
 *
 * Weighted, not arithmetic: an order filled 900 at 100 and 100 at 200 averaged
 * 110, and reporting 150 would misstate the customer's cost basis — which is
 * what every return figure in the app is computed against.
 */
function weightedAverage(order: Order, fill: { quantity: string; price: string }): string | null {
  const previousQty = toScaledInt(order.filledQuantity);
  const previousAvg = order.averageFillPrice === null ? null : toScaledInt(order.averageFillPrice);
  const fillQty = toScaledInt(fill.quantity);
  const fillPrice = toScaledInt(fill.price);

  if (fillQty === null || fillPrice === null || previousQty === null) {
    return null;
  }

  const scale = 10n ** BigInt(MAX_SCALE);
  const previousNotional = previousAvg === null ? 0n : (previousQty * previousAvg) / scale;
  const fillNotional = (fillQty * fillPrice) / scale;
  const totalQty = previousQty + fillQty;

  if (totalQty === 0n) {
    return null;
  }

  return fromScaledInt(((previousNotional + fillNotional) * scale) / totalQty);
}

/** Quantity still open. Never negative, by the guards in `applyFill`. */
export function remainingQuantity(order: Order): string | null {
  const total = toScaledInt(order.quantity);
  const filled = toScaledInt(order.filledQuantity);
  if (total === null || filled === null) return null;
  return fromScaledInt(total - filled);
}
