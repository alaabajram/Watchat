-- Sign in by email: a one-time link (30 minutes, used once). Only hashes are kept: the token's and the
-- email's HMAC (the email itself is never stored). Email-only viewers live at phone_e164 "+em:<id>".
create table if not exists email_logins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  email_hmac text not null,
  token_hash text not null unique,
  next_path text,
  ui_locale text not null default 'ar' check (ui_locale in ('ar', 'en')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists email_logins_recent on email_logins (tenant_id, email_hmac, created_at desc);
alter table email_logins enable row level security;
