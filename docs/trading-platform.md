# Live trading — technical scaffolding

> **Status:** design scaffolding. Nothing in this document is authorised to run
> against real money, and nothing in `app/lib/trading/` is wired to a route.
> **Owner:** solo founder · **Companion:** ROADMAP.md §8 (M6), `architecture.md`

---

## 0. The correction that has to come first

The question this work started from was *"we need a market-maker, no?"*

**No.** A market maker quotes two-sided prices to provide liquidity on a venue.
You would only need one if DISU were operating its own trading venue — an MTF —
which is several regulatory orders of magnitude beyond executing customer
orders. It is not on any realistic path here.

What actually stands between DISU and a "buy" button is a different list, and
every item on it is heavier than a market maker:

| What you need | Why | Who can hold it |
|---|---|---|
| Authorisation to **receive and transmit orders** (MiFID II RTO) | Taking an order from a customer is a regulated activity even when someone else fills it | Finansinspektionen-authorised firm, or an appointed representative of one |
| Authorisation to **execute** | Only if you route to the venue yourself rather than passing to a broker | Investment firm licence |
| **Custody** of client assets | Holding customer securities and cash is separately authorised, separately audited, and separately capitalised | Licensed custodian. **Never a one-person company.** |
| **Client-money segregation** | Customer cash cannot touch company cash, ever, including in insolvency | Bank or licensed firm with segregated accounts |
| **KYC/AML programme** | Onboarding, sanctions/PEP screening, ongoing monitoring, SAR filing to Finanspolisen | The regulated entity |
| **Capital + insurance** | Initial capital, own-funds requirement, professional indemnity | The regulated entity |
| **Transaction reporting** | MiFIR RTS 22, T+1, per order | The regulated entity |

The realistic conclusion, unchanged from ROADMAP §8: **DISU does not become the
regulated entity.** A licensed partner does execution, custody and KYC; DISU is
the interface. Everything below is designed for that shape, because designing
for the other one is designing for a company that does not exist yet.

### Two viable shapes

**A. Broker deeplink (do this first — it is an M4/M5 feature, not M6).**
A "Trade" button on a holding opens a pre-filled order ticket at the user's own
broker. No licence, no custody, no client money, no KYC. Captures most of the
user benefit for none of the regulatory cost. Anything in this document that is
not deeplinking should wait behind it.

**B. Introducing broker / embedded partner.** DISU collects the order intent and
hands it to a licensed partner over an API; the partner owns the customer
relationship of record, the custody, the KYC and the reporting. DISU becomes
either an appointed representative or a pure technology supplier depending on
where the contract draws the line — and **that line is the single most important
term in the agreement**, because it decides whether DISU is regulated.

The rest of this document scaffolds shape B, because shape A needs almost none
of it.

---

## 1. Multi-account architecture

Trading requires accounts DISU actually knows the balance of, which is a
different object from what `broker_connections` holds today. Today's accounts
are *read-only projections* of somebody else's account, synced from Tink or a
CSV. A trading account has cash, a settlement cycle and an order history.

Both must coexist — a user will have connected accounts they only read and one
account they trade — so this is a new table, not a column on the old one.

```
trading_accounts
  id, user_id, account_type (isk | kf | af), currency,
  partner_account_ref,        -- the licensed partner's id for this account
  status (pending_kyc | active | restricted | closed),
  opened_at, closed_at
```

**Swedish account types are not cosmetic.** ISK and KF are taxed on a notional
basis (schablonskatt) and AF on realised gains, so the account type determines
tax reporting, what a "return" figure even means, and which instruments are
permitted. Model it as a first-class column from day one; retrofitting it after
customers hold positions means a migration across live money.

### The ledger is the source of truth

Every movement — deposit, withdrawal, buy, sell, fee, tax, dividend — is a
double-entry row. Balances are **derived**, never stored as a mutable number.

```
ledger_entries
  id, account_id, entry_type, instrument, quantity, amount, currency,
  order_id (nullable), settlement_date, created_at,
  external_ref UNIQUE   -- the partner's id for this movement
```

Two properties this buys, both of which are the difference between a bug and an
incident:

- **Reconciliation is a query.** The partner is the record of truth for cash and
  custody; DISU's ledger must agree with theirs every day, and a daily job that
  diffs the two is only possible when every movement is a row.
- **`external_ref UNIQUE` makes replay safe.** Partner webhooks retry. A fill
  delivered twice must not credit twice, and a unique constraint on their id is
  a far better guarantee than application code remembering to check.

Money is `NUMERIC`, never a float, and never a JavaScript `number` in any code
path that decides a balance. The current codebase's own rule about `null` in
arithmetic (ROADMAP §2.7 — `0 + null` is `0`) applies twice as hard here: an
unpriced holding shows "—", but a miscounted krona is a reportable event.

---

## 2. Order lifecycle

The state machine is implemented as pure functions in
`app/lib/trading/order-state.ts` and pinned by `tests/trading-order-state.test.ts`.
It is deliberately the first piece written, because it is the piece that can be
made correct before any partner exists.

```
        ┌── rejected
draft → pending → working ──┬── filled
                            ├── partially_filled → filled | cancelled
                            ├── cancelled
                            └── expired
```

Rules the state machine enforces, each because the alternative is a way to lose
money:

1. **Terminal is terminal.** `filled`, `cancelled`, `rejected` and `expired`
   have no outgoing transitions. A late webhook cannot resurrect a dead order.
2. **Fills only ever accumulate.** `filledQuantity` is monotonic and can never
   exceed `quantity`. An over-fill is a partner bug, and it must surface as a
   rejected transition rather than as a position the customer does not have.
3. **The partner's status wins, but only forwards.** DISU never invents a state;
   it maps the partner's. Out-of-order delivery is normal, so a stale update is
   ignored rather than applied.
4. **Idempotency is mandatory.** Every order carries a client-generated key;
   submitting twice with the same key is one order. Without this, a double-tap
   on a flaky connection is a double position.

---

## 3. Deposits and withdrawals

**Client money never touches a DISU-controlled account.** The deposit flow moves
money from the customer's bank directly into the partner's segregated client
account. DISU renders the flow and records the resulting ledger entry; it is
never in the payment path.

For Sweden, the instrument is **Swish** for small amounts and **bank transfer /
Autogiro** for larger, or open-banking payment initiation (PIS) if the partner
supports it — which is worth asking about, because Tink is already integrated
for AIS and the same vendor often covers both.

Non-negotiables:

- **Name-matched accounts only.** The paying bank account must belong to the
  account holder. Third-party funding is a money-laundering typology and most
  partners forbid it outright.
- **Withdrawals return to the same account the deposit came from.** No
  redirection to a new destination without re-verification — this is the single
  most common account-takeover cash-out path.
- **Deposits are credited on settlement, not on initiation.** A pending transfer
  is not buying power. Showing it as such is how you end up extending credit you
  are not authorised to extend.
- **Every movement is screened** against sanctions and PEP lists before it
  settles, and the screening result is retained for the AML audit trail.

---

## 4. Security

The existing hardening (ROADMAP §2.3/§2.4 — rate limiting, breach-checked
passwords, server-side session revocation, per-route tenant isolation tests) is
the floor, not the bar. Moving money raises it:

| Control | Requirement |
|---|---|
| **Step-up auth** | Every order, every withdrawal, every payment-detail change re-authenticates. A live session is not consent to move money. |
| **MFA** | Mandatory, not optional, on any account with trading enabled. TOTP minimum; passkeys preferred, and they remove the phishing vector rather than narrowing it. |
| **Withdrawal allow-list** | New destination accounts have a cooling-off period. |
| **Idempotency keys** | On every mutating trading endpoint. See §2 rule 4. |
| **Append-only audit log** | Who did what, from where, when — separate store, write-only from the app's credentials, retained per MiFID II record-keeping (5 years, 7 on request). |
| **Segregated secrets** | Partner API credentials in a KMS/HSM, never in `.env`, rotated on a schedule, with per-environment separation that makes a staging key structurally unable to reach production. |
| **Server-side limits** | Position, order-size and daily-loss limits enforced in the API, never in the client. A client-side limit is a suggestion. |
| **Blast radius** | The trading service is its own deployable with its own database credentials. A read-only bug in the primer generator must not be able to reach `ledger_entries`. |

Two things the current architecture would need before any of this ships: the
hosting decision (ROADMAP §2.5, still open — trading cannot run on an
auto-pausing free tier, and the snapshot job already suffers from that), and
error alerting that actually reaches a human (§2.6, still open).

---

## 5. What has to be true before a single line of trading code runs

This is the gate, and it is deliberately expensive:

- [ ] M0 closed. All of it. Trading on an unhardened foundation is not a product, it is a liability.
- [ ] Company entity registered, capitalised, insured (ROADMAP D7)
- [ ] A signed partner agreement, with the regulated-perimeter line explicit
- [ ] Written legal opinion on whether DISU is an appointed representative or a technology supplier
- [ ] A compliance function that is a named person, not a document
- [ ] ≥ 6,000 WAP and positive revenue (ROADMAP §8 trigger)
- [ ] Broker deeplinking (shape A) shipped, measured, and demonstrably insufficient

If the last box cannot be ticked — if deeplinking turns out to satisfy the need —
then the correct outcome is to **not build this**, and that is a success, not a
failure.

---

## 6. What exists today

Scaffolding only. None of it is reachable from a route, and that is intentional.

| File | What it is |
|---|---|
| `app/lib/trading/types.ts` | The domain model: accounts, orders, fills, ledger entries. Types first, so the shape is arguable before it is expensive. |
| `app/lib/trading/order-state.ts` | The order state machine, pure and side-effect free. |
| `tests/trading-order-state.test.ts` | The rules in §2, pinned. |
| `db/migrations/0022_trading_accounts.sql` | The schema. **Written, not applied.** |

The migration is deliberately unapplied. There is still no migration runner and
no `schema_migrations` table (ROADMAP M0 checklist), so applying DDL is a manual,
verified act — and a table that will one day hold client money is the last place
to be casual about that.
