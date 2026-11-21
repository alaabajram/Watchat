-- Viewer assistant on the web + web push (the free alternative to WhatsApp marketing messages).

-- The assistant answers most messages without AI; free text it can't place uses the label's AI account
-- (cheapest model) within a daily limit that is separate from the admin team's monthly AI limit.
alter table tenant_ai_settings
  add column if not exists assistant_enabled boolean not null default true,
  add column if not exists assistant_daily_limit int not null default 300 check (assistant_daily_limit between 0 and 100000);

-- Web push keys (VAPID), created on first use. The private key is sealed with SETTINGS_ENCRYPTION_KEY.
create table if not exists push_config (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  public_key text not null,
  private_key_enc text not null,
  push_first boolean not null default true,  -- marketing messages go by push to viewers who turned it on
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table push_config enable row level security;

-- One row per browser / installed app a viewer turned alerts on in.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  viewer_id uuid not null references viewers(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  platform text,                            -- ios / android / desktop
  installed boolean not null default false, -- opened from the home screen
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  failures int not null default 0,
  revoked_at timestamptz
);
create index if not exists push_subscriptions_viewer on push_subscriptions (viewer_id) where revoked_at is null;
alter table push_subscriptions enable row level security;

-- What went out by push (instead of a WhatsApp template), for the spend meter's savings and the frequency cap.
create table if not exists push_messages (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  viewer_id uuid not null references viewers(id) on delete cascade,
  template_name text,
  category text,
  source text,
  ref_type text,
  ref_id text,
  node_id text,
  market text,
  status text not null check (status in ('sent', 'failed')),
  created_at timestamptz not null default now()
);
create index if not exists push_messages_viewer on push_messages (viewer_id, created_at desc);
create index if not exists push_messages_tenant on push_messages (tenant_id, created_at desc);
alter table push_messages enable row level security;
