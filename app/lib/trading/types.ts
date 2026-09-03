/**
 * The trading domain model.
 *
 * Scaffolding: nothing here is wired to a route, and nothing may be until the
 * gate in `docs/trading-platform.md` §5 is met. Types come first because the
 * shape is arguable while it is cheap, and because the alternative — deriving
 * the model from whichever partner API gets signed — bakes one vendor into
 * every table.
 *
 * The shape assumes the licensed-partner arrangement (`docs/trading-platform.md`
 * §0, shape B): a partner holds custody, client money and the KYC relationship,
 * and DISU keeps its own ledger that must reconcile against theirs daily. That
 * assumption shows up as `partnerRef` on almost everything — DISU's id and the
 * partner's id are both first-class, because reconciliation is impossible if a
 * row cannot be traced to its counterpart.
 *
 * **Money is never a `number` here.** Every monetary quantity is a decimal
 * string, carried to the database as NUMERIC and into arithmetic only through a
 * decimal library. IEEE-754 cannot represent 0.1, and a portfolio that shows an
 * unpriced holding as "—" (ROADMAP §2.7) must not be the same system that
 * silently drifts a customer's cash balance.
 */

/**
 * Swedish account types. Not cosmetic: ISK and KF are taxed on a notional
 * basis and AF on realised gains, so this column decides tax reporting, what a
 * "return" figure means, and which instruments are permitted.
 */
export type TradingAccountType = "isk" | "kf" | "af";

/**
 * `pending_kyc` is the opening state and it is not tradeable — the partner owns
 * onboarding, and an account exists in DISU before it is approved by them.
 * `restricted` covers everything from a failed sanctions re-screen to a partner
 * hold: readable, not tradeable.
 */
export type TradingAccountStatus = "pending_kyc" | "active" | "restricted" | "closed";

export type TradingAccount = {
  id: string;
  userId: string;
  accountType: TradingAccountType;
  /** Settlement currency. SEK for every account we would open today. */
  currency: string;
  /** The partner's identifier for this account. Null until they have opened it. */
  partnerRef: string | null;
  status: TradingAccountStatus;
  openedAt: string;
  closedAt: string | null;
};

export type OrderSide = "buy" | "sell";

/**
 * Market orders are deliberately absent from the first iteration. A retail
 * market order on a thin Nordic small cap is how a customer discovers slippage
 * with their own money; limit orders make the worst case explicit before it is
 * accepted.
 */
export type OrderKind = "limit";

/** How long the order lives if it does not fill. */
export type TimeInForce = "day" | "gtc";

export type OrderStatus =
  | "draft"
  | "pending"
  | "working"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "rejected"
  | "expired";

export type Order = {
  id: string;
  accountId: string;
  /**
   * Client-generated, unique per order, supplied by the caller and echoed to
   * the partner. This is what makes a retried submit one order instead of two;
   * see `docs/trading-platform.md` §2 rule 4.
   */
  idempotencyKey: string;
  symbol: string;
  side: OrderSide;
  kind: OrderKind;
  /** Decimal string. Whole shares for now — fractional is a partner capability. */
  quantity: string;
  /** Limit price, decimal string. */
  limitPrice: string;
  timeInForce: TimeInForce;
  status: OrderStatus;
  /** Monotonic. Never exceeds `quantity`. */
  filledQuantity: string;
  /** Quantity-weighted average of the fills so far, or null before the first. */
  averageFillPrice: string | null;
  partnerRef: string | null;
  /** Set only in `rejected`; the partner's reason, shown to the user verbatim. */
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * One execution against an order.
 *
 * Fills are immutable and additive: a correction is a new row, never an edit,
 * because an edited fill destroys the audit trail that MiFID II record-keeping
 * exists to preserve.
 */
export type Fill = {
  id: string;
  orderId: string;
  quantity: string;
  price: string;
  /** Commission and levies, in the account currency. */
  fee: string;
  executedAt: string;
  /**
   * The partner's id for this execution. Unique — partner webhooks retry, and a
   * fill delivered twice must not book twice. The uniqueness lives in the
   * database, not in application code that has to remember to check.
   */
  partnerRef: string;
};

/**
 * Ledger entry kinds. Every movement of value is one of these; there is no
 * "other".
 */
export type LedgerEntryType =
  | "deposit"
  | "withdrawal"
  | "buy"
  | "sell"
  | "fee"
  | "tax"
  | "dividend"
  | "correction";

/**
 * A double-entry ledger row.
 *
 * Balances are **derived** from these, never stored as a mutable number. A
 * stored balance and a movement history are two sources of truth for the same
 * fact, and they will disagree — usually at the least convenient moment.
 */
export type LedgerEntry = {
  id: string;
  accountId: string;
  entryType: LedgerEntryType;
  /** Null for pure cash movements (a deposit has no instrument). */
  instrument: string | null;
  /** Signed. Positive increases the position, negative reduces it. */
  quantity: string | null;
  /** Signed, in `currency`. Positive increases cash, negative reduces it. */
  amount: string;
  currency: string;
  orderId: string | null;
  settlementDate: string;
  /** The partner's id for this movement. Unique; see `Fill.partnerRef`. */
  externalRef: string;
  createdAt: string;
};
