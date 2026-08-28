alter table if exists broker_connections
  add column if not exists auth_provider text not null default 'manual',
  add column if not exists data_scope text not null default 'symbols_only';

create index if not exists broker_connections_auth_provider_idx
  on broker_connections(auth_provider);

create table if not exists broker_connection_accounts (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  connection_id text not null references broker_connections(id) on delete cascade,
  provider_account_id text not null,
  provider_account_name text not null,
  account_type text not null,
  selected boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id, provider_account_id)
);

create index if not exists broker_connection_accounts_user_idx
  on broker_connection_accounts(user_id);

create index if not exists broker_connection_accounts_connection_idx
  on broker_connection_accounts(connection_id);

create index if not exists broker_connection_accounts_selected_idx
  on broker_connection_accounts(connection_id, selected);

alter table if exists broker_connection_accounts enable row level security;

drop policy if exists broker_connection_accounts_service_role_all on broker_connection_accounts;

create policy broker_connection_accounts_service_role_all
  on broker_connection_accounts
  for all
  to service_role
  using (true)
  with check (true);
