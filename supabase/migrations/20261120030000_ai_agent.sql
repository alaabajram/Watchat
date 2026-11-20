-- AI scenario agent. Each label (tenant) connects its own AI account; the key is encrypted by the app
-- (AES-256-GCM, SETTINGS_ENCRYPTION_KEY) and never sent back to the browser.

create table tenant_ai_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  provider text not null default 'anthropic' check (provider in ('anthropic')),
  model text not null default 'claude-sonnet-5-5',
  api_key_enc text,
  api_key_last4 text,
  monthly_request_limit int not null default 200 check (monthly_request_limit between 0 and 100000),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references admin_users(id) on delete set null
);

-- One row per AI request, for the label's usage page and its monthly limit.
create table ai_usage (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  admin_id uuid references admin_users(id) on delete set null,
  purpose text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  ok boolean not null,
  error text,
  created_at timestamptz not null default now()
);
create index ai_usage_tenant_month on ai_usage (tenant_id, created_at desc);

-- Drafts the agent produced. Nothing reaches viewers until an admin applies one.
create table ai_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  series_id uuid not null references series(id) on delete cascade,
  prompt text not null,
  draft jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'applied', 'discarded')),
  parent_id uuid references ai_drafts(id) on delete set null,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_by uuid references admin_users(id) on delete set null,
  decided_at timestamptz
);
create index ai_drafts_tenant_created on ai_drafts (tenant_id, created_at desc);

alter table tenant_ai_settings enable row level security;
alter table ai_usage enable row level security;
alter table ai_drafts enable row level security;
