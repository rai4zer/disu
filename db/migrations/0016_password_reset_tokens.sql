create table if not exists password_reset_tokens (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_id_idx on password_reset_tokens(user_id);
create index if not exists password_reset_tokens_expires_at_idx on password_reset_tokens(expires_at desc);

alter table if exists password_reset_tokens enable row level security;

drop policy if exists password_reset_tokens_service_role_all on password_reset_tokens;
create policy password_reset_tokens_service_role_all
  on password_reset_tokens
  for all
  to service_role
  using (true)
  with check (true);
