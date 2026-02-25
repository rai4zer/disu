alter table if exists jobs
  add column if not exists idempotency_key text;

create unique index if not exists jobs_user_kind_idempotency_key_uniq
  on jobs(user_id, kind, idempotency_key)
  where idempotency_key is not null and idempotency_key <> '';
