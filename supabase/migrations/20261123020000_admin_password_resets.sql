-- "Forgot password" for admins: one-time reset links sent by email (only the token's hash is stored).
create table if not exists admin_password_resets (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references admin_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists admin_password_resets_admin on admin_password_resets (admin_id, created_at desc);
alter table admin_password_resets enable row level security;
