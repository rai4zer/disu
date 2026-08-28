-- Daily portfolio value history.
--
-- The one number a broker cannot give someone back: what their portfolio was
-- worth on a day that has already passed. Positions hold only *current* state —
-- a sync overwrites yesterday's market value in place — so unless a row is
-- written each day, that history does not exist and can never be reconstructed.
-- Hence ROADMAP §5.1: start recording in M0 even though the chart ships in M3.
--
-- One row per user per day. `snapshot_date` is the bucket; `captured_at` is when
-- the valuation was actually observed, because the two are not the same thing
-- and a reader charting this needs to know which.
--
-- `currency` is stored per row rather than assumed. The writer values everything
-- in the portfolio display currency (`PORTFOLIO_DISPLAY_CURRENCY`, default SEK),
-- but that is configuration and configuration changes — and a history whose unit
-- silently changed halfway is worse than one with a visible break in it. A
-- reader must compare like with like and break the series where the currency
-- does, instead of joining two different units into one line.
--
-- `total_value` covers `valued_position_count` of `position_count` holdings.
-- Holdings priced with a placeholder, and holdings with no FX rate into the
-- display currency, are excluded rather than folded in; a day where nothing
-- could be observed produces no row at all. A fabricated point in a history
-- chart is indistinguishable from a real one forever after
-- (docs/synthetic-data-policy.md).

create table if not exists portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  snapshot_date date not null,
  captured_at timestamptz not null default now(),
  currency text not null,
  total_value double precision not null check (total_value >= 0),
  -- Cost basis of the holdings whose cost we actually know, and the market value
  -- of exactly those same holdings. Both null together when no holding has a
  -- known cost. Paired so a return can be computed like-for-like instead of
  -- comparing a partial cost against a full portfolio value.
  cost_basis double precision check (cost_basis is null or cost_basis >= 0),
  costed_value double precision check (costed_value is null or costed_value >= 0),
  position_count integer not null check (position_count >= 0),
  valued_position_count integer not null check (valued_position_count > 0),
  constraint portfolio_snapshots_costed_pair check (
    (cost_basis is null and costed_value is null) or (cost_basis is not null and costed_value is not null)
  ),
  constraint portfolio_snapshots_valued_within_total check (valued_position_count <= position_count)
);

-- One row per user per day, enforced by the database rather than by the writer
-- checking first: several app instances run the same sweep, and the check-then-
-- insert between them is a race. The writer treats the resulting conflict as
-- "already captured" (app/lib/portfolio/snapshots.ts).
create unique index if not exists portfolio_snapshots_user_date_key
  on portfolio_snapshots(user_id, snapshot_date);

alter table if exists portfolio_snapshots enable row level security;

drop policy if exists portfolio_snapshots_service_role_all on portfolio_snapshots;

create policy portfolio_snapshots_service_role_all
  on portfolio_snapshots
  for all
  to service_role
  using (true)
  with check (true);
