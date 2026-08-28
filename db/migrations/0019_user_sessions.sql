-- Server-side session records, so a session can actually be revoked.
--
-- Before this, the session was a stateless signed cookie: logout only cleared
-- the browser's copy, a leaked token stayed valid for its full seven days, and
-- the sole way to revoke anything was rotating DISU_SESSION_SECRET — which signs
-- every user out at once (ROADMAP §2.3, risk R11).
--
-- The cookie still carries the signature; it now also carries `sid`, which names
-- a row here. A row that is missing, revoked or past its expiry means the token
-- is dead regardless of how well it is signed.
--
-- Deliberately holds no user agent, IP or device label. Those would be new
-- personal data to declare, retain and delete for no benefit the revoke button
-- does not already provide.

create table if not exists user_sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text
);

create index if not exists user_sessions_user_id_idx
  on user_sessions(user_id);

-- Retention pruning walks this: expired rows are dead weight once no token can
-- reference them.
create index if not exists user_sessions_expires_at_idx
  on user_sessions(expires_at);

alter table if exists user_sessions enable row level security;

drop policy if exists user_sessions_service_role_all on user_sessions;

create policy user_sessions_service_role_all
  on user_sessions
  for all
  to service_role
  using (true)
  with check (true);
