alter table if exists jobs
  add column if not exists stage text not null default 'queued';

update jobs
set stage = case
  when status = 'queued' then 'queued'
  when status = 'running' then 'running'
  when status = 'succeeded' then 'done'
  when status = 'failed' then 'failed'
  else 'queued'
end
where stage is null
   or stage = ''
   or stage not in ('queued', 'fetching', 'running', 'done', 'failed');

create index if not exists jobs_stage_run_after_idx on jobs(stage, run_after);

create table if not exists job_artifacts (
  id text primary key,
  job_id text not null references jobs(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  kind text not null,
  artifact_type text not null,
  artifact_path text not null,
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists job_artifacts_job_id_idx on job_artifacts(job_id);
create index if not exists job_artifacts_user_id_idx on job_artifacts(user_id);
create index if not exists job_artifacts_kind_created_at_idx on job_artifacts(kind, created_at desc);

alter table if exists job_artifacts enable row level security;

drop policy if exists job_artifacts_service_role_all on job_artifacts;
create policy job_artifacts_service_role_all
  on job_artifacts
  for all
  to service_role
  using (true)
  with check (true);
