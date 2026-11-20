-- Server errors, so the team (and coding agents) can see why a page failed without host log access.
-- Path and message only: no request bodies, cookies or phone numbers.
create table if not exists app_errors (
  id bigserial primary key,
  digest text,
  path text,
  route text,
  kind text,
  message text,
  stack text,
  created_at timestamptz not null default now()
);
create index if not exists app_errors_created on app_errors (created_at desc);
alter table app_errors enable row level security;
