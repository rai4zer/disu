alter table if exists jobs
  add column if not exists dismissed_at timestamptz;

create index if not exists jobs_user_kind_status_dismissed_idx
  on jobs(user_id, kind, status, dismissed_at, created_at desc);
