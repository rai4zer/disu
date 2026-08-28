create table if not exists broker_connection_secrets (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  connection_id text not null references broker_connections(id) on delete cascade,
  provider text not null,
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  token_scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id)
);

create index if not exists broker_connection_secrets_user_idx
  on broker_connection_secrets(user_id);

create index if not exists broker_connection_secrets_provider_idx
  on broker_connection_secrets(provider);

alter table if exists broker_connection_secrets enable row level security;

drop policy if exists broker_connection_secrets_service_role_all on broker_connection_secrets;

create policy broker_connection_secrets_service_role_all
  on broker_connection_secrets
  for all
  to service_role
  using (true)
  with check (true);
