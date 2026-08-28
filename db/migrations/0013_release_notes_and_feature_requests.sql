create table if not exists release_notes (
  id text primary key,
  slug text not null unique,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_by text not null references users(id) on delete restrict,
  updated_by text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists release_notes_status_published_idx
  on release_notes(status, published_at desc);

create table if not exists release_note_translations (
  id text primary key,
  release_note_id text not null references release_notes(id) on delete cascade,
  locale text not null check (locale in ('en', 'sv')),
  title text not null,
  body_markdown text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(release_note_id, locale)
);

create index if not exists release_note_translations_note_locale_idx
  on release_note_translations(release_note_id, locale);

create table if not exists feature_requests (
  id text primary key,
  user_id text references users(id) on delete set null,
  message text not null,
  status text not null default 'new' check (status in ('new', 'planned', 'done', 'rejected')),
  source_page text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feature_requests_status_created_idx
  on feature_requests(status, created_at desc);

create index if not exists feature_requests_user_created_idx
  on feature_requests(user_id, created_at desc);

create table if not exists feature_request_comments (
  id text primary key,
  feature_request_id text not null references feature_requests(id) on delete cascade,
  user_id text references users(id) on delete set null,
  message text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feature_request_comments_request_created_idx
  on feature_request_comments(feature_request_id, created_at asc);

create table if not exists feature_request_votes (
  id text primary key,
  feature_request_id text not null references feature_requests(id) on delete cascade,
  user_id text references users(id) on delete cascade,
  anon_token_hash text,
  created_at timestamptz not null default now(),
  check (
    (user_id is not null and anon_token_hash is null)
    or
    (user_id is null and anon_token_hash is not null)
  )
);

create unique index if not exists feature_request_votes_user_unique
  on feature_request_votes(feature_request_id, user_id)
  where user_id is not null;

create unique index if not exists feature_request_votes_anon_unique
  on feature_request_votes(feature_request_id, anon_token_hash)
  where anon_token_hash is not null;

create index if not exists feature_request_votes_request_created_idx
  on feature_request_votes(feature_request_id, created_at desc);

alter table if exists release_notes enable row level security;
alter table if exists release_note_translations enable row level security;
alter table if exists feature_requests enable row level security;
alter table if exists feature_request_comments enable row level security;
alter table if exists feature_request_votes enable row level security;

drop policy if exists release_notes_service_role_all on release_notes;
drop policy if exists release_note_translations_service_role_all on release_note_translations;
drop policy if exists feature_requests_service_role_all on feature_requests;
drop policy if exists feature_request_comments_service_role_all on feature_request_comments;
drop policy if exists feature_request_votes_service_role_all on feature_request_votes;

create policy release_notes_service_role_all
  on release_notes
  for all
  to service_role
  using (true)
  with check (true);

create policy release_note_translations_service_role_all
  on release_note_translations
  for all
  to service_role
  using (true)
  with check (true);

create policy feature_requests_service_role_all
  on feature_requests
  for all
  to service_role
  using (true)
  with check (true);

create policy feature_request_comments_service_role_all
  on feature_request_comments
  for all
  to service_role
  using (true)
  with check (true);

create policy feature_request_votes_service_role_all
  on feature_request_votes
  for all
  to service_role
  using (true)
  with check (true);
