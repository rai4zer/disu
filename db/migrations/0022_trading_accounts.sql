-- Live trading: accounts, orders, fills, ledger.
--
-- ============================================================================
-- NOT APPLIED. This migration is scaffolding and must not be run against any
-- database until the gate in docs/trading-platform.md §5 is met: M0 closed, a
-- registered and capitalised entity, a signed partner agreement, and a written
-- legal opinion on which side of the regulated perimeter DISU sits. There is
-- still no migration runner and no schema_migrations table (ROADMAP M0), so
-- applying DDL is a manual, verified act — and these are the last tables in the
-- app to be casual about, because one of them will hold claims on real money.
-- ============================================================================
--
-- The shape assumes the licensed-partner arrangement (docs/trading-platform.md
-- §0, shape B): a partner holds custody, client money and the KYC relationship.
-- Every table therefore carries both DISU's id and the partner's, because daily
-- reconciliation against their books is impossible if a row cannot be traced to
-- its counterpart.
--
-- Money is `numeric`, never `double precision`. The rest of this schema uses
-- doubles for portfolio values, which is defensible for a display figure that is
-- already an approximation of a market price. It is not defensible for a cash
-- balance: 0.1 has no exact binary representation, and a balance is a claim, not
-- an estimate.

-- --------------------------------------------------------------- accounts ---

-- Distinct from `broker_connection_accounts`, which is a read-only projection of
-- an account someone else holds. This is an account DISU knows the balance of.
-- Both coexist: a user will read several connected accounts and trade one.
create table if not exists trading_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id),
  -- ISK and KF are taxed on a notional basis, AF on realised gains. This column
  -- decides tax reporting, what a "return" figure means, and which instruments
  -- are permitted — so it is modelled from the start rather than retrofitted
  -- across live positions later.
  account_type text not null check (account_type in ('isk', 'kf', 'af')),
  currency text not null,
  -- The partner's id. Null until they have actually opened the account, which
  -- is why an account can exist here while still being untradeable.
  partner_ref text unique,
  status text not null default 'pending_kyc'
    check (status in ('pending_kyc', 'active', 'restricted', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint trading_accounts_closed_state check (
    (status = 'closed') = (closed_at is not null)
  )
);

create index if not exists trading_accounts_user_idx on trading_accounts(user_id);

-- ----------------------------------------------------------------- orders ---

create table if not exists trading_orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references trading_accounts(id),
  -- Client-generated and unique per account. This is what makes a retried
  -- submit one order instead of two; a double-tap on a flaky connection is
  -- otherwise a double position. The uniqueness lives here rather than in
  -- application code that has to remember to check.
  idempotency_key text not null,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  -- Limit only for now. A retail market order on a thin Nordic small cap is how
  -- a customer discovers slippage with their own money.
  kind text not null default 'limit' check (kind in ('limit')),
  quantity numeric(20, 8) not null check (quantity > 0),
  limit_price numeric(20, 8) not null check (limit_price > 0),
  time_in_force text not null default 'day' check (time_in_force in ('day', 'gtc')),
  status text not null default 'draft' check (
    status in ('draft', 'pending', 'working', 'partially_filled',
               'filled', 'cancelled', 'rejected', 'expired')
  ),
  filled_quantity numeric(20, 8) not null default 0 check (filled_quantity >= 0),
  average_fill_price numeric(20, 8) check (average_fill_price is null or average_fill_price > 0),
  partner_ref text unique,
  reject_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The database's copy of the rule in app/lib/trading/order-state.ts: a fill
  -- can never take an order past its own quantity. The state machine refuses an
  -- over-fill; this makes it impossible even if something bypasses the machine.
  constraint trading_orders_no_overfill check (filled_quantity <= quantity),
  constraint trading_orders_reject_reason check (
    (reject_reason is null) or (status = 'rejected')
  )
);

create unique index if not exists trading_orders_idempotency_key
  on trading_orders(account_id, idempotency_key);
create index if not exists trading_orders_account_idx on trading_orders(account_id);

-- ------------------------------------------------------------------ fills ---

-- Immutable and additive. A correction is a new row, never an edit: an edited
-- fill destroys the audit trail MiFID II record-keeping exists to preserve.
create table if not exists trading_fills (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references trading_orders(id),
  quantity numeric(20, 8) not null check (quantity > 0),
  price numeric(20, 8) not null check (price > 0),
  fee numeric(20, 8) not null default 0 check (fee >= 0),
  executed_at timestamptz not null,
  -- Partner webhooks retry. A fill delivered twice must not book twice, and a
  -- unique constraint is a far better guarantee than remembering to check.
  partner_ref text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists trading_fills_order_idx on trading_fills(order_id);

-- ----------------------------------------------------------------- ledger ---

-- Double entry. Balances are derived from these rows and never stored as a
-- mutable number: a stored balance and a movement history are two sources of
-- truth for one fact, and they will disagree at the worst possible moment.
create table if not exists trading_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references trading_accounts(id),
  entry_type text not null check (
    entry_type in ('deposit', 'withdrawal', 'buy', 'sell',
                   'fee', 'tax', 'dividend', 'correction')
  ),
  -- Null for pure cash movements: a deposit has no instrument.
  instrument text,
  -- Signed. Positive increases the position, negative reduces it.
  quantity numeric(20, 8),
  -- Signed, in `currency`. Positive increases cash, negative reduces it.
  amount numeric(20, 4) not null,
  currency text not null,
  order_id uuid references trading_orders(id),
  settlement_date date not null,
  external_ref text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists trading_ledger_account_idx
  on trading_ledger_entries(account_id, settlement_date);

-- ------------------------------------------------------------------- RLS ---

-- Same posture as every other table here: the service role is the only writer,
-- and per-user scoping is enforced in the app by userScoped() plus the
-- cross-tenant isolation tests (ROADMAP §2.4).
alter table if exists trading_accounts enable row level security;
alter table if exists trading_orders enable row level security;
alter table if exists trading_fills enable row level security;
alter table if exists trading_ledger_entries enable row level security;

drop policy if exists trading_accounts_service_role_all on trading_accounts;
create policy trading_accounts_service_role_all on trading_accounts
  for all to service_role using (true) with check (true);

drop policy if exists trading_orders_service_role_all on trading_orders;
create policy trading_orders_service_role_all on trading_orders
  for all to service_role using (true) with check (true);

drop policy if exists trading_fills_service_role_all on trading_fills;
create policy trading_fills_service_role_all on trading_fills
  for all to service_role using (true) with check (true);

drop policy if exists trading_ledger_service_role_all on trading_ledger_entries;
create policy trading_ledger_service_role_all on trading_ledger_entries
  for all to service_role using (true) with check (true);

-- ------------------------------------------------------------------ note ---
--
-- On erasure: note that `trading_accounts.user_id` deliberately has NO
-- `on delete cascade`, unlike every other user-owned table in this schema. A
-- financial record cannot be deleted on request — Swedish bokföringslag requires
-- seven years of retention, and MiFID II requires five on order records. GDPR
-- Art. 17(3)(b) is the exemption that permits this, and the honest handling is
-- for the delete to be *refused* and escalated to a human rather than to
-- silently cascade away a statutory record. That is the `blocks` policy in
-- app/lib/account/personal-data.ts, and it is why these tables are registered
-- there with that policy rather than with `erase`.
