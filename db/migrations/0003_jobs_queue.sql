create table if not exists jobs (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  kind text not null,
  status text not null,
  payload jsonb not null,
  result jsonb,
  error text,
  error_code text,
  attempts integer not null default 0,
  max_attempts integer not null default 2,
  run_after timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_user_id_idx on jobs(user_id);
create index if not exists jobs_status_run_after_idx on jobs(status, run_after);
create index if not exists jobs_created_at_idx on jobs(created_at desc);

alter table if exists jobs enable row level security;

drop policy if exists jobs_service_role_all on jobs;
create policy jobs_service_role_all
  on jobs
  for all
  to service_role
  using (true)
  with check (true);
