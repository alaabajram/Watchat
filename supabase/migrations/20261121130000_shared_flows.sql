-- Shared replies built on the flow builder canvas: one shared flow per brand (tenant).
-- What the bot answers to words a viewer sends outside a series' chat (ابدأ, رابط, حسابي, STOP, …).
-- Until a tenant publishes one, the bot uses the standard shared flow built from its saved Shared reply texts.

create table if not exists shared_flows (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  draft jsonb,
  draft_updated_at timestamptz,
  graph jsonb,                      -- the published flow the bot runs
  version int not null default 0,
  published_at timestamptz,
  published_by uuid,
  updated_at timestamptz not null default now()
);
alter table shared_flows enable row level security; -- server (service role) only, like the other tables
