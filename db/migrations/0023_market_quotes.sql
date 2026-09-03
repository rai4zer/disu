-- Shared market quote cache.
--
-- Two problems, one table.
--
-- The first is cost. Pricing goes through a Python bridge (python/src/market/
-- fetcher.py) whose cost is almost entirely interpreter startup and the yfinance
-- import -- ~1.9s before the first symbol, ~0.2s per symbol after. Nobody should
-- ever wait for that inside a request, so a background sweep writes here and the
-- routes read from here (app/lib/market/quote-cache.ts).
--
-- The second is ROADMAP §2.7 item 2.3: one fetch per symbol per interval across
-- all users, rather than per user. An in-process memory cache cannot do that --
-- it is per instance, and it dies with the process -- so the shared tier has to
-- be the database.
--
-- NOT user-owned. There is no `user_id` and there never should be: a quote for
-- VOLV-B.ST is the same fact for everyone, and giving it an owner would mean
-- storing the same reading once per holder. It is therefore deliberately absent
-- from USER_OWNED_TABLES in app/lib/db/user-scope.ts and reached through
-- `supabaseRequest()`, exactly as `analytics_events` is. Nothing here is
-- personal data, so it takes no entry in the GDPR register either -- knowing a
-- price does not say who asked for it.
--
-- The honesty rules this schema enforces, all of which exist because a cache is
-- the easiest place in a system to quietly invent a number
-- (docs/synthetic-data-policy.md):
--
--  * A row is an observation. `price` is `not null` with a positive check, so
--    "we could not price this" is the absence of a row, never a row holding
--    zero. A reader that finds nothing must render "--", not 0.
--  * `previous_close` is nullable and stays null when the feed did not supply
--    one. Every day-change derived from a guessed close is fabricated.
--  * Two timestamps, because they are two different facts and conflating them
--    is how a stale reading gets presented as current. `as_of` is when the feed
--    says the reading was taken; `fetched_at` is when we observed it. Staleness
--    for display is judged on `as_of`; sweep scheduling is judged on
--    `fetched_at`.
--  * `source` records which feed answered. There is no 'placeholder' value in
--    the check constraint -- the bridge has no synthetic mode, so a fabricated
--    price cannot be represented in this table at all. That is the constraint
--    doing the work MARKET_MOCK_FALLBACK_MODE does elsewhere.

create table if not exists market_quotes (
  symbol text primary key,
  price double precision not null check (price > 0),
  previous_close double precision check (previous_close is null or previous_close > 0),
  -- Nullable on purpose. Finnhub's /quote carries no currency, and inferring
  -- one from the ticker suffix would be right most of the time -- which is
  -- precisely what makes it dangerous, because a value that is usually right
  -- gets trusted and then totals a portfolio in the wrong unit.
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  as_of timestamptz,
  fetched_at timestamptz not null default now(),
  source text not null check (source in ('yfinance', 'finnhub'))
);

-- The sweep's only query: which symbols have gone stale enough to refetch.
create index if not exists market_quotes_fetched_at_idx on market_quotes(fetched_at);

alter table if exists market_quotes enable row level security;

drop policy if exists market_quotes_service_role_all on market_quotes;

create policy market_quotes_service_role_all
  on market_quotes
  for all
  to service_role
  using (true)
  with check (true);
