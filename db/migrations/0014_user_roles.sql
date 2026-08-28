create table if not exists user_roles (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  role text not null check (role in ('admin')),
  created_at timestamptz not null default now(),
  unique(user_id, role)
);

create index if not exists user_roles_user_id_idx
  on user_roles(user_id);

create index if not exists user_roles_role_idx
  on user_roles(role);

alter table if exists user_roles enable row level security;

drop policy if exists user_roles_service_role_all on user_roles;

create policy user_roles_service_role_all
  on user_roles
  for all
  to service_role
  using (true)
  with check (true);

insert into user_roles (id, user_id, role, created_at)
select
  'url_' || encode(gen_random_bytes(6), 'hex'),
  u.id,
  'admin',
  now()
from users u
where lower(u.email) = 'anoyayousef1@gmail.com'
on conflict (user_id, role) do nothing;
