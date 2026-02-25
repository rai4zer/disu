create extension if not exists pgcrypto;

create table if not exists users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  password_salt text not null,
  created_at timestamptz not null default now()
);

create table if not exists broker_connections (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  broker text not null,
  status text not null,
  external_account_id text,
  consent_expires_at timestamptz,
  last_synced_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists broker_connections_user_id_idx on broker_connections(user_id);
create index if not exists broker_connections_user_broker_idx on broker_connections(user_id, broker);
create index if not exists broker_connections_status_idx on broker_connections(status);

create table if not exists positions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  connection_id text not null references broker_connections(id) on delete cascade,
  symbol text not null,
  isin text not null,
  name text not null,
  quantity double precision not null,
  avg_cost double precision not null,
  currency text not null,
  market_value double precision not null,
  as_of timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists positions_user_id_idx on positions(user_id);
create index if not exists positions_connection_id_idx on positions(connection_id);
create index if not exists positions_symbol_idx on positions(symbol);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  action text not null,
  status text not null,
  duration_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_user_id_idx on events(user_id);
create index if not exists events_action_idx on events(action);
create index if not exists events_created_at_idx on events(created_at desc);
