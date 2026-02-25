alter table if exists jobs
  add column if not exists queued_ms integer,
  add column if not exists fetch_ms integer,
  add column if not exists run_ms integer;
