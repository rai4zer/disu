-- Google sign-in. Google-only accounts have no password at all, so the password
-- columns become nullable; app/lib/auth/users.ts refuses to authenticate a row
-- with a null hash, and the password-reset flow is how such a user adds one.
alter table users alter column password_hash drop not null;
alter table users alter column password_salt drop not null;

-- Google's `sub` claim: stable per Google account, never reused, and unlike the
-- email it never changes. This is the identity we match on once linked.
alter table users add column if not exists google_sub text;

create unique index if not exists users_google_sub_key
  on users(google_sub)
  where google_sub is not null;
