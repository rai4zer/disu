create table if not exists watchlists (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  ticker text not null,
  active boolean not null default true,
  frequency text not null default 'weekly',
  send_weekday smallint not null default 5,
  send_time text not null default '16:30',
  timezone text not null default 'Europe/Stockholm',
  locale text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ticker)
);

create index if not exists watchlists_user_active_idx on watchlists(user_id, active);
create index if not exists watchlists_send_slot_idx on watchlists(active, frequency, send_weekday, send_time);

alter table if exists watchlists enable row level security;

drop policy if exists watchlists_service_role_all on watchlists;
create policy watchlists_service_role_all
  on watchlists
  for all
  to service_role
  using (true)
  with check (true);

create table if not exists email_subscriptions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  channel text not null default 'weekly_quant',
  enabled boolean not null default false,
  locale text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, channel)
);

create index if not exists email_subscriptions_user_channel_idx on email_subscriptions(user_id, channel);

alter table if exists email_subscriptions enable row level security;

drop policy if exists email_subscriptions_service_role_all on email_subscriptions;
create policy email_subscriptions_service_role_all
  on email_subscriptions
  for all
  to service_role
  using (true)
  with check (true);

create table if not exists weekly_quant_updates (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  ticker text not null,
  week_of date not null,
  payload jsonb not null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, ticker, week_of)
);

create index if not exists weekly_quant_updates_user_week_idx on weekly_quant_updates(user_id, week_of desc);

alter table if exists weekly_quant_updates enable row level security;

drop policy if exists weekly_quant_updates_service_role_all on weekly_quant_updates;
create policy weekly_quant_updates_service_role_all
  on weekly_quant_updates
  for all
  to service_role
  using (true)
  with check (true);
