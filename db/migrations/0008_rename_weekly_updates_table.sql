do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'weekly_quant_updates'
  ) then
    alter table weekly_quant_updates rename to quant_update_deliveries;
  end if;
end $$;

-- Ensure index name is aligned with the new table naming.
do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'i'
      and c.relname = 'weekly_quant_updates_user_week_idx'
      and n.nspname = 'public'
  ) then
    alter index weekly_quant_updates_user_week_idx rename to quant_update_deliveries_user_week_idx;
  end if;
end $$;

-- Recreate policy with the new table name.
do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'quant_update_deliveries'
      and policyname = 'weekly_quant_updates_service_role_all'
  ) then
    drop policy weekly_quant_updates_service_role_all on quant_update_deliveries;
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'quant_update_deliveries'
      and policyname = 'quant_update_deliveries_service_role_all'
  ) then
    create policy quant_update_deliveries_service_role_all
      on quant_update_deliveries
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

-- Defensive: if table exists but index/policy do not (fresh environments), create them.
create index if not exists quant_update_deliveries_user_week_idx
  on quant_update_deliveries(user_id, week_of desc);

alter table if exists quant_update_deliveries enable row level security;
