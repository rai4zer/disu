import assert from "node:assert/strict";
import test from "node:test";
import {
  addDecimal,
  applyFill,
  applyStatus,
  canTransition,
  compareDecimal,
  isTerminal,
  remainingQuantity,
  TERMINAL_STATUSES
} from "../app/lib/trading/order-state.ts";
import type { Order } from "../app/lib/trading/types.ts";

// The rules in docs/trading-platform.md §2, pinned. This module is pure, so the
// rules can be tested exhaustively rather than against a partner sandbox.

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: "ord_1",
    accountId: "acc_1",
    idempotencyKey: "key_1",
    symbol: "VOLV-B.ST",
    side: "buy",
    kind: "limit",
    quantity: "100",
    limitPrice: "280.50",
    timeInForce: "day",
    status: "working",
    filledQuantity: "0",
    averageFillPrice: null,
    partnerRef: "partner_1",
    rejectReason: null,
    createdAt: "2026-08-30T09:00:00.000Z",
    updatedAt: "2026-08-30T09:00:00.000Z",
    ...overrides
  };
}

const AT = "2026-08-30T09:30:00.000Z";

test("terminal states have no outgoing transitions", () => {
  for (const status of TERMINAL_STATUSES) {
    assert.ok(isTerminal(status), `${status} must be terminal`);
    for (const target of ["pending", "working", "partially_filled", "filled"] as const) {
      assert.equal(canTransition(status, target), false, `${status} -> ${target} must be refused`);
    }
  }
});

test("a late update on a finished order is refused, not applied", () => {
  // The ordinary case, not an exceptional one: a cancel confirmation that lost
  // the race to the fill it was trying to prevent.
  const filled = order({ status: "filled", filledQuantity: "100" });
  const result = applyStatus(filled, "cancelled", AT);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "terminal");
});

test("an illegal transition is refused", () => {
  const draft = order({ status: "draft" });
  const result = applyStatus(draft, "filled", AT);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "illegal_transition");
});

test("a legal transition advances the order and stamps the time", () => {
  const pending = order({ status: "pending" });
  const result = applyStatus(pending, "working", AT);
  assert.ok(result.ok);
  assert.equal(result.ok && result.order.status, "working");
  assert.equal(result.ok && result.order.updatedAt, AT);
});

test("a partial fill accumulates and leaves the order open", () => {
  const result = applyFill(order(), { quantity: "40", price: "280.50", at: AT });
  assert.ok(result.ok);
  assert.equal(result.ok && result.order.status, "partially_filled");
  assert.equal(result.ok && result.order.filledQuantity, "40");
  assert.equal(remainingQuantity(result.ok ? result.order : order()), "60");
});

test("fills that complete the quantity close the order", () => {
  const first = applyFill(order(), { quantity: "40", price: "280", at: AT });
  assert.ok(first.ok);
  const second = applyFill(first.ok ? first.order : order(), { quantity: "60", price: "281", at: AT });
  assert.ok(second.ok);
  assert.equal(second.ok && second.order.status, "filled");
  assert.equal(second.ok && second.order.filledQuantity, "100");
  assert.equal(remainingQuantity(second.ok ? second.order : order()), "0");
});

test("an over-fill is refused rather than clamped", () => {
  // The customer must not end up holding a position they did not order, and a
  // silently clamped number would hide a partner bug that needs an operator.
  const result = applyFill(order({ filledQuantity: "90" }), { quantity: "20", price: "280", at: AT });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "overfill");
});

test("a zero or negative fill quantity is refused", () => {
  for (const quantity of ["0", "-10"]) {
    const result = applyFill(order(), { quantity, price: "280", at: AT });
    assert.equal(result.ok, false, `${quantity} must be refused`);
    assert.equal(result.ok === false && result.reason, "invalid_quantity");
  }
});

test("a fill on a finished order is refused", () => {
  const result = applyFill(order({ status: "filled", filledQuantity: "100" }), {
    quantity: "10",
    price: "280",
    at: AT
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "terminal");
});

test("the average fill price is quantity-weighted, not arithmetic", () => {
  // 900 @ 100 then 100 @ 200 averages 110. An arithmetic mean would say 150 and
  // misstate the cost basis every return figure is computed against.
  const first = applyFill(order({ quantity: "1000" }), { quantity: "900", price: "100", at: AT });
  assert.ok(first.ok);
  const second = applyFill(first.ok ? first.order : order(), { quantity: "100", price: "200", at: AT });
  assert.ok(second.ok);
  assert.equal(second.ok && second.order.averageFillPrice, "110");
});

test("thirds of a quantity sum exactly, where floating point would not", () => {
  // 0.1 + 0.2 !== 0.3 in IEEE-754. Were these parsed as floats, an order filled
  // in thirds would never reach its quantity and would sit partially filled
  // forever while the position was understated.
  assert.equal(addDecimal("0.1", "0.2"), "0.3");

  let current = order({ quantity: "0.3", filledQuantity: "0" });
  for (const slice of ["0.1", "0.1", "0.1"]) {
    const step = applyFill(current, { quantity: slice, price: "10", at: AT });
    assert.ok(step.ok, `filling ${slice} must succeed`);
    if (step.ok) current = step.order;
  }
  assert.equal(current.status, "filled");
  assert.equal(current.filledQuantity, "0.3");
});

test("decimal comparison rejects values it cannot represent exactly", () => {
  assert.equal(compareDecimal("1.5", "1.50"), 0);
  assert.equal(compareDecimal("2", "10"), -1);
  assert.equal(compareDecimal("10", "2"), 1);
  // More precision than the scale we accept must not be silently truncated.
  assert.equal(compareDecimal("0.000000001", "0"), null);
  assert.equal(compareDecimal("abc", "1"), null);
});
