-- The funnel event stream: the anonymous-capable half of product analytics.
--
-- `events` cannot serve this. Its `user_id` is `not null references users(id)`
-- and every write goes through `userScoped()`, which is exactly right for an
-- audit log and structurally impossible for a funnel: `landing_view` and
-- `signup_start` happen before an account exists, so the two events that decide
-- whether the funnel is working are the two `recordEvent()` can never carry
-- (ROADMAP §2.6).
--
-- Hence a separate table rather than a nullable column on `events`. Keeping them
-- apart matters beyond the constraint:
--
--   * `events` is an audit trail held under legitimate interest. This table is
--     analytics, held under consent alone — no row is written without it
--     (app/lib/analytics/funnel-store.ts). Two lawful bases, two tables, so
--     neither one's retention or erasure rules leak into the other.
--   * `events` is user-owned and tenant-scoped. This one is deliberately not,
--     which is safe only because the app never reads a row back per user. There
--     is no route that returns anything from here.
--
-- `properties` is jsonb, but not a free-for-all: the writable keys and their
-- shapes are declared per event in app/lib/analytics/funnel.ts and anything else
-- is dropped before it reaches the insert. The endpoint is unauthenticated by
-- necessity, and an open bag on a public write path is a PII leak waiting for a
-- careless call site.

create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- 'client' or 'server'. Stored rather than derived so a later taxonomy change
  -- cannot silently rewrite the history of where an event came from.
  origin text not null,
  -- The visit-scoped anonymous id from sessionStorage. Null for server-recorded
  -- events, which have a real user instead.
  anon_id text,
  -- Nullable on purpose: the top of the funnel has no account. `on delete
  -- cascade` matches the "erase" policy declared in
  -- app/lib/account/personal-data.ts.
  user_id text references users(id) on delete cascade,
  -- A normalised route (`/portfolio/:id`), never a raw URL. Query strings carry
  -- reset tokens and OAuth codes; id segments re-identify the person the
  -- anonymous id was meant to keep anonymous.
  path text,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- A row belonging to nobody at all is unjoinable and therefore unqueryable as
  -- a funnel step. A client event always carries an anon id, a server event
  -- always carries a user id; anything else is a bug, and the database says so
  -- rather than accumulating rows nothing can use.
  constraint analytics_events_subject_present check (anon_id is not null or user_id is not null)
);

-- The funnel query is "count each step over a window", so name+time is the
-- access path that matters.
create index if not exists analytics_events_name_created_at_idx
  on analytics_events(name, created_at desc);

-- Retention pruning walks this (app/lib/analytics/funnel-store.ts).
create index if not exists analytics_events_created_at_idx
  on analytics_events(created_at desc);

-- Stitching one visit's steps together, and the per-user half of the funnel.
create index if not exists analytics_events_anon_id_idx
  on analytics_events(anon_id)
  where anon_id is not null;

create index if not exists analytics_events_user_id_idx
  on analytics_events(user_id)
  where user_id is not null;

alter table if exists analytics_events enable row level security;

drop policy if exists analytics_events_service_role_all on analytics_events;

create policy analytics_events_service_role_all
  on analytics_events
  for all
  to service_role
  using (true)
  with check (true);
