-- Watchat — initial schema (prototype + MVP core)
-- Every viewer-facing table carries tenant_id (directly or through its parent) so a partner brand
-- can run on the same database later. RLS is enabled on every table with NO policies:
-- only the server (service role key) can read or write. The browser never talks to the DB directly.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tenants (brands)
-- ---------------------------------------------------------------------------
create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  brand jsonb not null default '{}'::jsonb,         -- logo, colours, domain
  wa_phone_number_id text,                           -- Meta phone number ID for this brand
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Viewers: the WhatsApp number is the account
-- ---------------------------------------------------------------------------
create table traffic_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  type text not null check (type in ('ctwa_ad', 'creator', 'share', 'organic')),
  series_code text,
  campaign_ref text,                                 -- Meta ad / campaign id, creator handle, etc.
  label text,
  created_at timestamptz not null default now()
);

create table viewers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  -- TODO(security): encrypt at rest before launch (e.g. app-level AES-GCM); lookups use phone_hmac.
  phone_e164 text not null,
  phone_hmac text not null,                          -- keyed hash used for lookups and analytics
  wa_profile_name text,
  language text check (language in ('ar', 'ar_en_subs')),
  ui_locale text not null default 'ar' check (ui_locale in ('ar', 'en')),
  country text,
  first_source_id uuid references traffic_sources(id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (tenant_id, phone_hmac)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references viewers(id) on delete cascade,
  token_hash text not null unique,                   -- sha256 of the cookie value
  user_agent text,
  ip text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index sessions_viewer_idx on sessions (viewer_id) where revoked_at is null;

create table link_tokens (
  token_hash text primary key,                       -- sha256 of the token in the URL
  viewer_id uuid not null references viewers(id) on delete cascade,
  purpose text not null check (purpose in ('ep_link', 'resume', 'pay', 'menu')),
  series_id uuid,
  episode_number int,
  uses_left int not null default 3,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table opt_ins (
  id bigserial primary key,
  viewer_id uuid not null references viewers(id) on delete cascade,
  topic text not null default 'new_episodes',
  status text not null check (status in ('in', 'out')),
  source text,                                       -- 'button', 'stop_command', 'settings'
  created_at timestamptz not null default now()
);
create index opt_ins_viewer_idx on opt_ins (viewer_id, topic, created_at desc);

-- ---------------------------------------------------------------------------
-- Content
-- ---------------------------------------------------------------------------
create table series (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  code text not null,                                -- e.g. SECRETS01, sent in the first WhatsApp message
  title_ar text not null,
  title_en text not null,
  synopsis_ar text,
  synopsis_en text,
  poster_url text,
  trailer_video_url text,                            -- small MP4 (< 16 MB) for WhatsApp
  dialect text not null default 'gulf',
  status text not null default 'draft' check (status in ('draft', 'in_review', 'live', 'archived')),
  wa_episode_count int not null default 3,           -- episodes sent inside the chat
  free_web_until_ep int not null default 9,          -- episodes up to this number are free on the web
  paywall_ep int not null default 10,
  coins_per_episode int not null default 30,
  season_pass_price_aed numeric(10,2),
  season_pass_price_sar numeric(10,2),
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table episodes (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references series(id) on delete cascade,
  number int not null,
  title_ar text,
  title_en text,
  duration_s int,
  stream_uid text,                                   -- Cloudflare Stream video id (web, adaptive HLS)
  wa_video_url_ar text,                              -- small MP4 for chat, Arabic
  wa_video_url_en text,                              -- small MP4 for chat, English subtitles burned in
  coin_price_override int,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'live')),
  unique (series_id, number)
);

create table licences (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references series(id) on delete cascade,
  licensor text not null,
  territory text not null,
  starts_on date not null,
  ends_on date,
  document_url text,
  revenue_share_pct numeric(5,2),
  created_at timestamptz not null default now()
);

create table content_reviews (
  id uuid primary key default gen_random_uuid(),
  series_id uuid references series(id) on delete cascade,
  episode_id uuid references episodes(id) on delete cascade,
  reviewer text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Money: coins, wallet ledger, orders, entitlements
-- ---------------------------------------------------------------------------
create table coin_packs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  coins int not null check (coins > 0),
  bonus_coins int not null default 0,
  price_aed numeric(10,2) not null,
  price_sar numeric(10,2) not null,
  active boolean not null default true,
  sort int not null default 0
);

-- Append-only. The balance is always sum(delta); never update or delete rows.
create table wallet_ledger (
  id bigserial primary key,
  viewer_id uuid not null references viewers(id),
  delta int not null,
  reason text not null check (reason in ('purchase', 'unlock', 'grant', 'refund', 'expiry')),
  ref_type text,
  ref_id text,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);
create index wallet_ledger_viewer_idx on wallet_ledger (viewer_id);

create view wallet_balances as
  select viewer_id, coalesce(sum(delta), 0)::int as balance
  from wallet_ledger group by viewer_id;

create table orders (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references viewers(id),
  item_type text not null check (item_type in ('coin_pack', 'season_pass')),
  item_ref text not null,
  amount numeric(10,2) not null,
  currency text not null check (currency in ('AED', 'SAR')),
  vat_amount numeric(10,2) not null default 0,
  gateway text not null default 'tap' check (gateway in ('tap', 'dcb')),
  gateway_charge_id text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table entitlements (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references viewers(id) on delete cascade,
  series_id uuid not null references series(id),
  episode_number int,                                -- null = whole series (season pass)
  source text not null check (source in ('coins', 'pass', 'grant', 'ad')),
  created_at timestamptz not null default now(),
  unique nulls not distinct (viewer_id, series_id, episode_number)
);

create table progress (
  viewer_id uuid not null references viewers(id) on delete cascade,
  episode_id uuid not null references episodes(id) on delete cascade,
  position_s int not null default 0,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (viewer_id, episode_id)
);

-- ---------------------------------------------------------------------------
-- WhatsApp: chat state, de-duplication, message log
-- ---------------------------------------------------------------------------
create table chat_state (
  viewer_id uuid primary key references viewers(id) on delete cascade,
  series_id uuid references series(id),
  step text not null default 'idle',                 -- idle | lang | trailer | episodes | linked
  wa_episode int not null default 0,                 -- last episode sent in chat
  updated_at timestamptz not null default now()
);

-- Meta can deliver the same webhook more than once; we store each inbound id once.
create table wa_inbound (
  wa_message_id text primary key,
  received_at timestamptz not null default now()
);

create table wa_messages (
  id bigserial primary key,
  viewer_id uuid references viewers(id) on delete set null,
  direction text not null check (direction in ('in', 'out')),
  wa_message_id text,
  kind text,
  template_name text,
  category text,                                     -- marketing | utility | service
  status text,                                       -- sent | delivered | read | failed
  error text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Funnel events
-- ---------------------------------------------------------------------------
create table events (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id),
  viewer_hmac text,
  name text not null,
  series_id uuid,
  episode_number int,
  source_id uuid,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index events_name_time_idx on events (tenant_id, name, created_at);
create index events_series_idx on events (series_id, name);

-- ---------------------------------------------------------------------------
-- Lock everything down: server-only access through the service role.
-- ---------------------------------------------------------------------------
alter table tenants enable row level security;
alter table traffic_sources enable row level security;
alter table viewers enable row level security;
alter table sessions enable row level security;
alter table link_tokens enable row level security;
alter table opt_ins enable row level security;
alter table series enable row level security;
alter table episodes enable row level security;
alter table licences enable row level security;
alter table content_reviews enable row level security;
alter table coin_packs enable row level security;
alter table wallet_ledger enable row level security;
alter table orders enable row level security;
alter table entitlements enable row level security;
alter table progress enable row level security;
alter table chat_state enable row level security;
alter table wa_inbound enable row level security;
alter table wa_messages enable row level security;
alter table events enable row level security;

-- The balance view runs with the caller's permissions, so it stays server-only too.
alter view wallet_balances set (security_invoker = true);

-- Atomically consume one use of a link token. Returns the row if it was valid.
create or replace function redeem_link_token(p_token_hash text)
returns table (viewer_id uuid, series_id uuid, episode_number int, purpose text)
language sql
set search_path = public
as $$
  update link_tokens
     set uses_left = uses_left - 1
   where token_hash = p_token_hash
     and uses_left > 0
     and expires_at > now()
  returning link_tokens.viewer_id, link_tokens.series_id, link_tokens.episode_number, link_tokens.purpose;
$$;

-- Only the server may call it (not the public anon / publishable keys).
revoke execute on function redeem_link_token(text) from public, anon, authenticated;
grant execute on function redeem_link_token(text) to service_role;
