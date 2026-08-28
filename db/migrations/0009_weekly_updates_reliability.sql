alter table if exists watchlists
  add column if not exists send_window_minutes smallint not null default 120;

create table if not exists weekly_update_runs (
  id text primary key,
  run_id text not null unique,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists weekly_update_runs_started_idx
  on weekly_update_runs(started_at desc);

alter table if exists weekly_update_runs enable row level security;

drop policy if exists weekly_update_runs_service_role_all on weekly_update_runs;
create policy weekly_update_runs_service_role_all
  on weekly_update_runs
  for all
  to service_role
  using (true)
  with check (true);

create table if not exists weekly_update_dead_letters (
  id text primary key,
  run_id text not null,
  user_id text not null references users(id) on delete cascade,
  ticker text not null,
  week_of date not null,
  attempts integer not null,
  stage text not null default 'send',
  error text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists weekly_update_dead_letters_run_idx
  on weekly_update_dead_letters(run_id, created_at desc);
create index if not exists weekly_update_dead_letters_user_idx
  on weekly_update_dead_letters(user_id, created_at desc);

alter table if exists weekly_update_dead_letters enable row level security;

drop policy if exists weekly_update_dead_letters_service_role_all on weekly_update_dead_letters;
create policy weekly_update_dead_letters_service_role_all
  on weekly_update_dead_letters
  for all
  to service_role
  using (true)
  with check (true);

create table if not exists email_suppressions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  channel text not null default 'weekly_quant',
  active boolean not null default true,
  source text not null default 'manual',
  reason text not null default 'suppressed',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, channel)
);

create index if not exists email_suppressions_active_idx
  on email_suppressions(channel, active, updated_at desc);

alter table if exists email_suppressions enable row level security;

drop policy if exists email_suppressions_service_role_all on email_suppressions;
create policy email_suppressions_service_role_all
  on email_suppressions
  for all
  to service_role
  using (true)
  with check (true);
