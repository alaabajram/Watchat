-- Watchat — admin, editable bot, scenarios, CRM messaging, wallet operations, device trust.
-- All tables stay server-only (RLS on, no policies). Money moves only through the functions below.

-- ---------------------------------------------------------------------------
-- Admin users, sessions, audit
-- ---------------------------------------------------------------------------
create table admin_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  email text not null,
  name text,
  role text not null check (role in ('owner', 'content', 'marketing', 'support', 'finance')),
  password_hash text not null,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  disabled_at timestamptz,
  unique (tenant_id, email)
);

create table admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references admin_users(id) on delete cascade,
  token_hash text not null unique,
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create table audit_log (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id),
  admin_id uuid references admin_users(id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_time_idx on audit_log (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed window, atomic)
-- ---------------------------------------------------------------------------
create table rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits int not null
);

-- Returns true if this hit is allowed.
create or replace function hit_rate_limit(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_hits int;
begin
  insert into rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;

-- ---------------------------------------------------------------------------
-- Editable bot copy and scenario settings
-- ---------------------------------------------------------------------------
create table bot_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  series_id uuid references series(id) on delete cascade,   -- null = default for all series
  key text not null,
  lang text not null check (lang in ('ar', 'en')),
  body text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references admin_users(id) on delete set null,
  unique nulls not distinct (tenant_id, series_id, key, lang)
);

alter table series
  add column ask_language boolean not null default true,
  add column send_trailer boolean not null default true,
  add column ask_opt_in boolean not null default true;

-- ---------------------------------------------------------------------------
-- WhatsApp templates, sequences, campaigns
-- ---------------------------------------------------------------------------
create table wa_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (name ~ '^[a-z0-9_]{1,512}$'),
  lang text not null check (lang in ('ar', 'en')),
  category text not null check (category in ('marketing', 'utility')),
  header_type text not null default 'none' check (header_type in ('none', 'image')),
  body text not null,                        -- uses {{1}} = series title, {{2}} = episode number
  button_text text,                          -- URL button; URL = APP_URL/w/{{1}} (personal link token)
  meta_template_id text,
  meta_status text not null default 'draft', -- draft | PENDING | APPROVED | REJECTED | PAUSED | DISABLED
  meta_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name, lang)
);

create table sequences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  trigger text not null check (trigger in ('stopped_mid_series', 'inactive', 'finished_series')),
  delay_hours int not null check (delay_hours between 1 and 2160),
  template_name text not null,               -- sent in the viewer's language (ar / en row of wa_templates)
  series_id uuid references series(id) on delete cascade,   -- null = all series
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sequence_sends (
  id bigserial primary key,
  sequence_id uuid not null references sequences(id) on delete cascade,
  viewer_id uuid not null references viewers(id) on delete cascade,
  ref text not null,                         -- what this send was about, so each moment is messaged once
  status text not null,
  wa_message_id text,
  error text,
  sent_at timestamptz not null default now(),
  unique (sequence_id, viewer_id, ref)
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  template_name text not null,
  series_id uuid references series(id),      -- the series the message promotes (title + link)
  segment jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  scheduled_at timestamptz,
  audience_count int,
  estimated_cost_usd numeric(10,2),
  sent_count int not null default 0,
  failed_count int not null default 0,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table campaign_sends (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  viewer_id uuid not null references viewers(id) on delete cascade,
  status text not null,
  wa_message_id text,
  error text,
  sent_at timestamptz not null default now(),
  primary key (campaign_id, viewer_id)
);

-- Latest opt-in status per viewer.
create or replace view viewer_opt_in as
  select distinct on (viewer_id) viewer_id, status, created_at
  from opt_ins
  where topic = 'new_episodes'
  order by viewer_id, created_at desc;
alter view viewer_opt_in set (security_invoker = true);

-- Opted-in viewers matching a segment.
-- segment keys (all optional): language ('ar' | 'ar_en_subs'), country ('AE' | 'SA' | …),
-- series_id (started this series), paid (true | false), inactive_days (int), active_within_days (int)
create or replace function campaign_audience(p_tenant uuid, p_segment jsonb)
returns table (viewer_id uuid, phone_e164 text, language text, country text)
language sql
stable
set search_path = public
as $$
  select v.id, v.phone_e164, coalesce(v.language, 'ar'), v.country
  from viewers v
  join viewer_opt_in o on o.viewer_id = v.id and o.status = 'in'
  where v.tenant_id = p_tenant
    and (p_segment->>'language' is null or v.language = p_segment->>'language')
    and (p_segment->>'country' is null or v.country = p_segment->>'country')
    and (p_segment->>'series_id' is null or exists (
          select 1 from chat_state c where c.viewer_id = v.id and c.series_id = (p_segment->>'series_id')::uuid
          union all
          select 1 from progress p join episodes e on e.id = p.episode_id
           where p.viewer_id = v.id and e.series_id = (p_segment->>'series_id')::uuid))
    and (p_segment->>'paid' is null
         or (p_segment->>'paid')::boolean = exists (select 1 from orders x where x.viewer_id = v.id and x.status = 'paid'))
    and (p_segment->>'inactive_days' is null
         or v.last_seen_at < now() - make_interval(days => (p_segment->>'inactive_days')::int))
    and (p_segment->>'active_within_days' is null
         or v.last_seen_at >= now() - make_interval(days => (p_segment->>'active_within_days')::int));
$$;

-- Viewers due for a sequence message right now, with the `ref` that makes each moment unique.
create or replace function sequence_candidates(p_sequence uuid)
returns table (viewer_id uuid, phone_e164 text, language text, country text, series_id uuid, episode_number int, ref text)
language plpgsql
stable
set search_path = public
as $$
declare
  s sequences%rowtype;
begin
  select * into s from sequences where id = p_sequence;
  if not found or not s.active then return; end if;

  if s.trigger = 'stopped_mid_series' then
    return query
      with last_watch as (
        select distinct on (p.viewer_id, e.series_id)
               p.viewer_id, e.series_id, e.number, p.updated_at
        from progress p join episodes e on e.id = p.episode_id
        where (s.series_id is null or e.series_id = s.series_id)
        order by p.viewer_id, e.series_id, e.number desc
      )
      select v.id, v.phone_e164, coalesce(v.language, 'ar'), v.country, lw.series_id, lw.number,
             lw.series_id::text || ':' || lw.number::text
      from last_watch lw
      join viewers v on v.id = lw.viewer_id and v.tenant_id = s.tenant_id
      join viewer_opt_in o on o.viewer_id = v.id and o.status = 'in'
      where lw.updated_at <= now() - make_interval(hours => s.delay_hours)
        and lw.updated_at > now() - make_interval(hours => s.delay_hours + 72)
        and v.last_seen_at <= now() - make_interval(hours => s.delay_hours)
        and lw.number < (select max(e2.number) from episodes e2 where e2.series_id = lw.series_id and e2.status = 'live')
        and not exists (select 1 from sequence_sends ss
                        where ss.sequence_id = s.id and ss.viewer_id = v.id
                          and ss.ref = lw.series_id::text || ':' || lw.number::text);

  elsif s.trigger = 'inactive' then
    return query
      select v.id, v.phone_e164, coalesce(v.language, 'ar'), v.country,
             c.series_id, null::int, to_char(v.last_seen_at, 'YYYY-MM-DD')
      from viewers v
      join viewer_opt_in o on o.viewer_id = v.id and o.status = 'in'
      left join chat_state c on c.viewer_id = v.id
      where v.tenant_id = s.tenant_id
        and v.last_seen_at <= now() - make_interval(hours => s.delay_hours)
        and v.last_seen_at > now() - make_interval(hours => s.delay_hours + 72)
        and (s.series_id is null or c.series_id = s.series_id)
        and not exists (select 1 from sequence_sends ss
                        where ss.sequence_id = s.id and ss.viewer_id = v.id
                          and ss.ref = to_char(v.last_seen_at, 'YYYY-MM-DD'));

  elsif s.trigger = 'finished_series' then
    return query
      select v.id, v.phone_e164, coalesce(v.language, 'ar'), v.country, e.series_id, e.number, e.series_id::text
      from progress p
      join episodes e on e.id = p.episode_id
      join viewers v on v.id = p.viewer_id and v.tenant_id = s.tenant_id
      join viewer_opt_in o on o.viewer_id = v.id and o.status = 'in'
      where p.completed_at is not null
        and (s.series_id is null or e.series_id = s.series_id)
        and e.number = (select max(e2.number) from episodes e2 where e2.series_id = e.series_id and e2.status = 'live')
        and p.completed_at <= now() - make_interval(hours => s.delay_hours)
        and p.completed_at > now() - make_interval(hours => s.delay_hours + 72)
        and not exists (select 1 from sequence_sends ss
                        where ss.sequence_id = s.id and ss.viewer_id = v.id and ss.ref = e.series_id::text);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Device trust: spending from a device needs proof of the WhatsApp number
-- ---------------------------------------------------------------------------
alter table sessions add column trusted_at timestamptz;

create table spend_confirmations (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references viewers(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{6}$'),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'expired')),
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index spend_confirmations_viewer_idx on spend_confirmations (viewer_id, status);

-- Called by the bot when the viewer sends "CONFIRM <code>" from their WhatsApp number.
create or replace function confirm_spend_code(p_viewer uuid, p_code text)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_session uuid;
begin
  update spend_confirmations
     set status = 'confirmed'
   where id = (select id from spend_confirmations
                where viewer_id = p_viewer and code = p_code and status = 'pending' and expires_at > now()
                order by created_at desc limit 1)
  returning session_id into v_session;
  if v_session is null then return false; end if;
  update sessions set trusted_at = now() where id = v_session and revoked_at is null;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Wallet operations (atomic; the ledger stays append-only)
-- ---------------------------------------------------------------------------
create or replace function wallet_balance(p_viewer uuid)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce(sum(delta), 0)::int from wallet_ledger where viewer_id = p_viewer;
$$;

-- Unlock one episode with coins. Returns 'ok', 'already' or 'insufficient'.
create or replace function unlock_episode(p_viewer uuid, p_series uuid, p_episode int, p_price int)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_balance int;
begin
  if p_price <= 0 then raise exception 'price must be positive'; end if;
  -- Serialise money operations per viewer.
  perform 1 from viewers where id = p_viewer for update;
  if exists (select 1 from entitlements
              where viewer_id = p_viewer and series_id = p_series
                and (episode_number = p_episode or episode_number is null)) then
    return 'already';
  end if;
  v_balance := wallet_balance(p_viewer);
  if v_balance < p_price then return 'insufficient'; end if;
  insert into wallet_ledger (viewer_id, delta, reason, ref_type, ref_id, idempotency_key)
  values (p_viewer, -p_price, 'unlock', 'episode', p_series::text || ':' || p_episode::text,
          'unlock:' || p_viewer::text || ':' || p_series::text || ':' || p_episode::text);
  insert into entitlements (viewer_id, series_id, episode_number, source)
  values (p_viewer, p_series, p_episode, 'coins');
  return 'ok';
end;
$$;

-- Fulfil a paid order exactly once. Returns 'ok' or 'already'.
create or replace function fulfil_order(p_order uuid, p_charge_id text)
returns text
language plpgsql
set search_path = public
as $$
declare
  o orders%rowtype;
  v_coins int;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;
  if o.status = 'paid' then return 'already'; end if;

  update orders set status = 'paid', paid_at = now(), gateway_charge_id = p_charge_id where id = p_order;

  if o.item_type = 'coin_pack' then
    select coins + bonus_coins into v_coins from coin_packs where id = o.item_ref::uuid;
    insert into wallet_ledger (viewer_id, delta, reason, ref_type, ref_id, idempotency_key)
    values (o.viewer_id, v_coins, 'purchase', 'order', o.id::text, 'order:' || o.id::text);
  elsif o.item_type = 'season_pass' then
    insert into entitlements (viewer_id, series_id, episode_number, source)
    values (o.viewer_id, o.item_ref::uuid, null, 'pass')
    on conflict do nothing;
  end if;
  return 'ok';
end;
$$;

-- Support grants (admin). Positive only; reason text kept in ref_id.
create or replace function grant_coins(p_viewer uuid, p_coins int, p_admin uuid, p_note text)
returns int
language plpgsql
set search_path = public
as $$
begin
  if p_coins <= 0 or p_coins > 10000 then raise exception 'grant must be 1..10000 coins'; end if;
  perform 1 from viewers where id = p_viewer for update;
  insert into wallet_ledger (viewer_id, delta, reason, ref_type, ref_id)
  values (p_viewer, p_coins, 'grant', 'admin:' || p_admin::text, left(coalesce(p_note, ''), 200));
  return wallet_balance(p_viewer);
end;
$$;

alter table orders add column checkout_url text;

-- ---------------------------------------------------------------------------
-- Lock down new tables and functions
-- ---------------------------------------------------------------------------
alter table admin_users enable row level security;
alter table admin_sessions enable row level security;
alter table audit_log enable row level security;
alter table rate_limits enable row level security;
alter table bot_messages enable row level security;
alter table wa_templates enable row level security;
alter table sequences enable row level security;
alter table sequence_sends enable row level security;
alter table campaigns enable row level security;
alter table campaign_sends enable row level security;
alter table spend_confirmations enable row level security;

revoke execute on function hit_rate_limit(text, int, int) from public, anon, authenticated;
revoke execute on function campaign_audience(uuid, jsonb) from public, anon, authenticated;
revoke execute on function sequence_candidates(uuid) from public, anon, authenticated;
revoke execute on function confirm_spend_code(uuid, text) from public, anon, authenticated;
revoke execute on function wallet_balance(uuid) from public, anon, authenticated;
revoke execute on function unlock_episode(uuid, uuid, int, int) from public, anon, authenticated;
revoke execute on function fulfil_order(uuid, text) from public, anon, authenticated;
revoke execute on function grant_coins(uuid, int, uuid, text) from public, anon, authenticated;

grant execute on function hit_rate_limit(text, int, int) to service_role;
grant execute on function campaign_audience(uuid, jsonb) to service_role;
grant execute on function sequence_candidates(uuid) to service_role;
grant execute on function confirm_spend_code(uuid, text) to service_role;
grant execute on function wallet_balance(uuid) to service_role;
grant execute on function unlock_episode(uuid, uuid, int, int) to service_role;
grant execute on function fulfil_order(uuid, text) to service_role;
grant execute on function grant_coins(uuid, int, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Link redemption now also reports when the link was minted and whether this was its first use,
-- so a link opened within minutes of being sent can start a trusted session.
-- ---------------------------------------------------------------------------
drop function if exists redeem_link_token(text);
create function redeem_link_token(p_token_hash text)
returns table (viewer_id uuid, series_id uuid, episode_number int, purpose text, minted_at timestamptz, first_use boolean)
language sql
set search_path = public
as $$
  update link_tokens
     set uses_left = uses_left - 1
   where token_hash = p_token_hash
     and uses_left > 0
     and expires_at > now()
  returning link_tokens.viewer_id, link_tokens.series_id, link_tokens.episode_number, link_tokens.purpose,
            link_tokens.created_at, (link_tokens.uses_left = 2);
$$;
revoke execute on function redeem_link_token(text) from public, anon, authenticated;
grant execute on function redeem_link_token(text) to service_role;
