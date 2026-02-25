-- Step 1 hardening: enable RLS and restrict table access to service_role.
-- This app currently uses server-side Supabase key access, so service_role is expected.

alter table if exists users enable row level security;
alter table if exists broker_connections enable row level security;
alter table if exists positions enable row level security;
alter table if exists events enable row level security;

-- Remove old policies if re-running migration manually.
drop policy if exists users_service_role_all on users;
drop policy if exists broker_connections_service_role_all on broker_connections;
drop policy if exists positions_service_role_all on positions;
drop policy if exists events_service_role_all on events;

create policy users_service_role_all
  on users
  for all
  to service_role
  using (true)
  with check (true);

create policy broker_connections_service_role_all
  on broker_connections
  for all
  to service_role
  using (true)
  with check (true);

create policy positions_service_role_all
  on positions
  for all
  to service_role
  using (true)
  with check (true);

create policy events_service_role_all
  on events
  for all
  to service_role
  using (true)
  with check (true);
