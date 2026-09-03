-- Instrument detail cache: the four tabs of the instrument page.
--
-- Why a cache is not optional here. The detail bridge costs ~3s per symbol
-- (interpreter start, the yfinance import, then four upstream calls), and
-- unlike the quote sweep this cannot be pre-warmed: the symbol is whatever
-- someone opened, out of ~800 held names plus anything searchable. So the first
-- viewer of a symbol pays the spawn and every viewer after them reads a row.
--
-- One JSONB payload rather than a modelled schema, deliberately. The shape is
-- defined and validated at the boundary that has to be strict --
-- docs/contracts/instrument-profile.schema.json, parsed by
-- app/lib/market/instrument-bridge.ts -- and modelling it a second time in DDL
-- would mean a migration every time a filer reports a line we did not
-- anticipate. This table stores what the bridge returned; it does not
-- re-interpret it.
--
-- NOT user-owned. A company profile is the same fact for everyone, so there is
-- no `user_id`, it stays out of USER_OWNED_TABLES, and it is reached through
-- `supabaseRequest()` like `market_quotes` and `analytics_events`. Nothing here
-- is personal data: knowing Volvo's revenue does not say who looked it up.
--
-- The honesty rules, same as market_quotes:
--
--  * `fetched_at` is our clock -- when we observed this -- and is the only
--    timestamp here. There is no feed-side "as of" because the payload is a
--    composite of four upstream calls with different vintages; the page shows
--    per-period labels from the statements themselves rather than claiming one
--    timestamp for the lot.
--  * `sections` is stored alongside the payload so a reader knows which tabs
--    this row can render without parsing the whole blob. An empty tab is never
--    rendered, so a symbol whose financials are absent shows three tabs, not
--    four with one blank (docs/synthetic-data-policy.md).
--  * A symbol that could not be resolved writes no row. "We have nothing" is
--    the absence of a row, never a row of nulls -- which the UI would render as
--    a real instrument that nobody has data for.

create table if not exists instrument_profiles (
  symbol text primary key,
  -- The parsed bridge payload: profile, financials, news, analysts.
  payload jsonb not null,
  -- EQUITY | INDEX | FUTURE | CURRENCY | CRYPTOCURRENCY. Denormalised out of
  -- the payload because it is the discriminator for which tabs can exist, and
  -- a listing should not have to open every blob to group by it.
  quote_type text,
  -- Which tabs this row supports, e.g. {"overview":true,"kpi":false,...}
  sections jsonb not null,
  fetched_at timestamptz not null default now()
);

-- The only query besides the primary-key lookup: find rows old enough to refresh.
create index if not exists instrument_profiles_fetched_at_idx on instrument_profiles(fetched_at);

alter table if exists instrument_profiles enable row level security;

drop policy if exists instrument_profiles_service_role_all on instrument_profiles;

create policy instrument_profiles_service_role_all
  on instrument_profiles
  for all
  to service_role
  using (true)
  with check (true);
