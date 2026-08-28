create table if not exists manual_positions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  ticker text not null,
  shares double precision not null check (shares > 0),
  avg_cost double precision check (avg_cost is null or avg_cost >= 0),
  account_type text check (account_type in ('ISK', 'AF', 'KF', 'Other')),
  broker text,
  currency text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists manual_positions_user_id_idx on manual_positions(user_id);
create index if not exists manual_positions_ticker_idx on manual_positions(ticker);