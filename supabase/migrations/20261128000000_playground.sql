-- Watchat Playground (phase 1): configurable Rooms, AI People, Fortune Teller, Daily Horoscope, daily streaks
-- and one generic way to spend Ping. Nothing existing is changed or removed except widening the ledger reasons.

-- ---------------------------------------------------------------------------
-- Rooms: a room is configuration (mechanic + texts + costs), not code. Rounds run one per day.
-- ---------------------------------------------------------------------------
create table rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  mechanic text not null check (mechanic in ('poll', 'would_you_rather', 'opinion', 'hot_seat', 'liar', 'guess', 'debate')),
  title_ar text not null,
  title_en text not null,
  blurb_ar text not null default '',
  blurb_en text not null default '',
  emoji text not null default '💬',
  color text not null default '#ff5a48' check (color ~ '^#[0-9a-fA-F]{6}$'),
  status text not null default 'draft' check (status in ('draft', 'live', 'archived')),
  config jsonb not null default '{}'::jsonb,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table room_rounds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  day date not null,
  prompt_ar text not null default '',
  prompt_en text not null default '',
  options jsonb not null default '[]'::jsonb,   -- [{id, ar, en, correct?, reveal_ar?, reveal_en?}]
  extra jsonb not null default '{}'::jsonb,     -- clues, guest, explanation…
  status text not null default 'draft' check (status in ('draft', 'approved')),
  source text not null default 'team' check (source in ('team', 'ai')),
  created_at timestamptz not null default now(),
  unique (room_id, day)
);
create index room_rounds_day_idx on room_rounds (tenant_id, day);

create table room_answers (
  round_id uuid not null references room_rounds(id) on delete cascade,
  viewer_id uuid not null references viewers(id) on delete cascade,
  option_id text not null check (char_length(option_id) <= 20),
  correct boolean,
  created_at timestamptz not null default now(),
  primary key (round_id, viewer_id)
);
create index room_answers_round_idx on room_answers (round_id, option_id);

-- ---------------------------------------------------------------------------
-- AI People: personality templates the team manages; chats keep 30 days of history.
-- ---------------------------------------------------------------------------
create table ai_people (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  name_ar text not null,
  name_en text not null,
  role_ar text not null default '',
  role_en text not null default '',
  emoji text not null default '🙂',
  color text not null default '#7c5cff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  persona text not null default '' check (char_length(persona) <= 4000),
  greeting_ar text not null default '',
  greeting_en text not null default '',
  starters jsonb not null default '[]'::jsonb,  -- [{ar, en}]
  status text not null default 'draft' check (status in ('draft', 'live')),
  free_per_day int not null default 10 check (free_per_day between 0 and 500),
  ping_per_message int not null default 1 check (ping_per_message between 0 and 1000),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table ai_chats (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  viewer_id uuid not null references viewers(id) on delete cascade,
  person_id uuid not null references ai_people(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (viewer_id, person_id)
);

create table ai_chat_messages (
  id bigserial primary key,
  chat_id uuid not null references ai_chats(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 4000),
  paid boolean not null default false,
  created_at timestamptz not null default now()
);
create index ai_chat_messages_chat_idx on ai_chat_messages (chat_id, created_at);
create index ai_chat_messages_age_idx on ai_chat_messages (created_at);

-- ---------------------------------------------------------------------------
-- Daily: horoscopes (drafted ahead, approved by the team), the viewer's card / question / readings, streaks.
-- ---------------------------------------------------------------------------
create table horoscopes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sign text not null check (sign in ('aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces')),
  day date not null,
  text_ar text not null default '',
  text_en text not null default '',
  extra jsonb not null default '{}'::jsonb,     -- lucky number, colour, mood
  status text not null default 'draft' check (status in ('draft', 'approved')),
  source text not null default 'team' check (source in ('team', 'ai')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, sign, day)
);

alter table viewers add column if not exists star_sign text
  check (star_sign is null or star_sign in ('aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'));

-- One card and one daily-question answer per viewer per day.
create table daily_draws (
  viewer_id uuid not null references viewers(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('card', 'question')),
  pick int not null,
  reversed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (viewer_id, kind, day)
);
create index daily_draws_day_idx on daily_draws (tenant_id, kind, day);

create table tarot_readings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  viewer_id uuid not null references viewers(id) on delete cascade,
  question text not null default '' check (char_length(question) <= 300),
  cards jsonb not null,                          -- [{card, reversed}]
  text text not null default '' check (char_length(text) <= 6000),
  lang text not null default 'ar' check (lang in ('ar', 'en')),
  created_at timestamptz not null default now()
);
create index tarot_readings_viewer_idx on tarot_readings (viewer_id, created_at desc);

create table habit_days (
  viewer_id uuid not null references viewers(id) on delete cascade,
  day date not null,
  primary key (viewer_id, day)
);

create table playground_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  reading_ping int not null default 20 check (reading_ping between 0 and 10000),
  people_daily_ai_cap int not null default 2000 check (people_daily_ai_cap between 0 and 1000000),
  horoscope_auto_approve boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table rooms enable row level security;
alter table room_rounds enable row level security;
alter table room_answers enable row level security;
alter table ai_people enable row level security;
alter table ai_chats enable row level security;
alter table ai_chat_messages enable row level security;
alter table horoscopes enable row level security;
alter table daily_draws enable row level security;
alter table tarot_readings enable row level security;
alter table habit_days enable row level security;
alter table playground_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Spend Ping on anything (an extra AI message, a reading, a room extra), exactly once per key.
-- The ledger stays append-only: a spend is a new negative row.
-- ---------------------------------------------------------------------------
alter table wallet_ledger drop constraint if exists wallet_ledger_reason_check;
alter table wallet_ledger add constraint wallet_ledger_reason_check
  check (reason in ('purchase', 'unlock', 'grant', 'refund', 'expiry', 'merge', 'spend'));

create or replace function spend_ping(p_viewer uuid, p_amount int, p_ref_type text, p_ref_id text, p_key text)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_balance int;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_amount > 100000 then raise exception 'amount too large'; end if;
  perform 1 from viewers where id = p_viewer for update;
  if exists (select 1 from wallet_ledger where idempotency_key = p_key) then return 'already'; end if;
  v_balance := wallet_balance(p_viewer);
  if v_balance < p_amount then return 'insufficient'; end if;
  insert into wallet_ledger (viewer_id, delta, reason, ref_type, ref_id, idempotency_key)
  values (p_viewer, -p_amount, 'spend', left(p_ref_type, 40), left(p_ref_id, 200), p_key);
  return 'ok';
end;
$$;
revoke execute on function spend_ping(uuid, int, text, text, text) from public, anon, authenticated;
grant execute on function spend_ping(uuid, int, text, text, text) to service_role;
