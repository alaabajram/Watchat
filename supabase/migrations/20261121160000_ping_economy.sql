-- Ping economy (بينج): the viewer currency, country pricing, licensing, passes, rewards, promotions,
-- referrals and affiliates. Money moves only through the functions at the end (atomic, exactly once);
-- wallet_ledger stays append-only. Ping bought with money is reason 'purchase'; free Ping is reason 'grant'
-- with ref_type saying why (welcome, checkin, referral, promo, first_purchase, admin).

-- ---------------------------------------------------------------------------
-- Platform settings (Admin → Pricing & Ping)
-- ---------------------------------------------------------------------------
create table if not exists economy_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  welcome_ping int not null default 50 check (welcome_ping between 0 and 10000),
  episode_ping int not null default 10 check (episode_ping between 1 and 10000),         -- default for new series
  checkin_ladder int[] not null default '{2,2,3,3,5,5,10}',                              -- day 1..7 of a streak
  first_purchase_bonus_pct int not null default 20 check (first_purchase_bonus_pct between 0 and 300),
  referral_friend_ping int not null default 20 check (referral_friend_ping between 0 and 10000),
  referral_referrer_ping int not null default 50 check (referral_referrer_ping between 0 and 10000),
  referral_monthly_cap int not null default 20 check (referral_monthly_cap between 0 and 1000),
  recurring_enabled boolean not null default false,  -- Tap "Save Card" switched on: passes renew automatically
  default_country text not null default 'AE',
  updated_at timestamptz not null default now()
);
alter table economy_settings enable row level security;
insert into economy_settings (tenant_id) select id from tenants on conflict do nothing;

-- Countries we sell in. 'ZZ' = everywhere else (international price list).
create table if not exists markets (
  tenant_id uuid not null references tenants(id) on delete cascade,
  country text not null check (country ~ '^[A-Z]{2}$'),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  vat_rate numeric(5,4) not null default 0 check (vat_rate between 0 and 0.5),
  active boolean not null default true,
  sort int not null default 0,
  primary key (tenant_id, country)
);
alter table markets enable row level security;

insert into markets (tenant_id, country, currency, vat_rate, sort)
select t.id, m.country, m.currency, m.vat, m.sort
from tenants t
cross join (values
  ('AE', 'AED', 0.05, 1), ('SA', 'SAR', 0.15, 2), ('KW', 'KWD', 0.00, 3), ('QA', 'QAR', 0.00, 4),
  ('BH', 'BHD', 0.10, 5), ('OM', 'OMR', 0.05, 6), ('ZZ', 'USD', 0.00, 99)
) as m(country, currency, vat, sort)
on conflict do nothing;

-- Prices per country, VAT included, in that country's currency.
-- item: 'pack:<coin_packs.id>', 'series_pass' (fixed fee, any one series), 'weekly', 'yearly' (all series).
create table if not exists market_prices (
  tenant_id uuid not null references tenants(id) on delete cascade,
  country text not null,
  item text not null check (item ~ '^(pack:[0-9a-f-]{36}|series_pass|weekly|yearly)$'),
  price numeric(12,3) not null check (price > 0),
  primary key (tenant_id, country, item),
  foreign key (tenant_id, country) references markets(tenant_id, country) on delete cascade
);
alter table market_prices enable row level security;

-- Ping packs replace the old coin packs (1 episode = 10 Ping). Old packs stay for order history, off sale.
alter table coin_packs alter column price_aed drop not null;
alter table coin_packs alter column price_sar drop not null;
alter table coin_packs add column if not exists label_ar text;
alter table coin_packs add column if not exists label_en text;
update coin_packs set active = false;

with new_packs as (
  insert into coin_packs (tenant_id, coins, bonus_coins, active, sort)
  select t.id, p.coins, p.bonus, true, p.sort
  from tenants t cross join (values (250, 0, 1), (500, 100, 2), (1000, 300, 3), (2500, 1000, 4)) as p(coins, bonus, sort)
  returning id, tenant_id, coins
)
insert into market_prices (tenant_id, country, item, price)
select np.tenant_id, pr.country, 'pack:' || np.id::text, pr.price
from new_packs np
join (values
  (250, 'AE', 19), (500, 'AE', 37), (1000, 'AE', 75), (2500, 'AE', 185),
  (250, 'SA', 19), (500, 'SA', 39), (1000, 'SA', 79), (2500, 'SA', 189),
  (250, 'KW', 1.5), (500, 'KW', 3), (1000, 'KW', 6), (2500, 'KW', 15),
  (250, 'QA', 19), (500, 'QA', 37), (1000, 'QA', 75), (2500, 'QA', 185),
  (250, 'BH', 1.9), (500, 'BH', 3.9), (1000, 'BH', 7.5), (2500, 'BH', 19),
  (250, 'OM', 1.9), (500, 'OM', 3.9), (1000, 'OM', 7.9), (2500, 'OM', 19.5),
  (250, 'ZZ', 4.99), (500, 'ZZ', 9.99), (1000, 'ZZ', 19.99), (2500, 'ZZ', 49.99)
) as pr(coins, country, price) on pr.coins = np.coins;

-- Passes: weekly $9 and yearly $180 (all series), and a fixed series pass, in each country's currency.
insert into market_prices (tenant_id, country, item, price)
select t.id, p.country, p.item, p.price
from tenants t cross join (values
  ('AE', 'weekly', 33), ('AE', 'yearly', 659), ('AE', 'series_pass', 29),
  ('SA', 'weekly', 34), ('SA', 'yearly', 675), ('SA', 'series_pass', 30),
  ('KW', 'weekly', 2.8), ('KW', 'yearly', 55), ('KW', 'series_pass', 2.5),
  ('QA', 'weekly', 33), ('QA', 'yearly', 655), ('QA', 'series_pass', 29),
  ('BH', 'weekly', 3.4), ('BH', 'yearly', 68), ('BH', 'series_pass', 3),
  ('OM', 'weekly', 3.5), ('OM', 'yearly', 69), ('OM', 'series_pass', 3),
  ('ZZ', 'weekly', 9), ('ZZ', 'yearly', 180), ('ZZ', 'series_pass', 7.99)
) as p(country, item, price)
on conflict do nothing;

-- Episodes cost 10 Ping (was 30 coins). Each series can still set its own price.
alter table series alter column coins_per_episode set default 10;
update series set coins_per_episode = 10;

-- Licensing: the countries a series may be shown in. Empty = every country we sell in.
alter table series add column if not exists license_countries text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- Viewers: where they are, who brought them
-- ---------------------------------------------------------------------------
create table if not exists affiliates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  code text not null check (code ~ '^[A-Z0-9]{3,20}$'),
  commission_pct numeric(5,2) not null default 20 check (commission_pct between 0 and 90),
  window_days int not null default 90 check (window_days between 1 and 3650),  -- purchases count this long after joining
  contact text,
  notes text,
  active boolean not null default true,
  clicks int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
alter table affiliates enable row level security;

alter table viewers add column if not exists ip_country text;                     -- last seen country (from the IP)
alter table viewers add column if not exists referral_code text unique;           -- their own invite code
alter table viewers add column if not exists referred_by uuid references viewers(id) on delete set null;
alter table viewers add column if not exists affiliate_id uuid references affiliates(id) on delete set null;
alter table viewers add column if not exists affiliate_at timestamptz;

-- ---------------------------------------------------------------------------
-- Orders: any market currency, passes, promotions, partner attribution
-- ---------------------------------------------------------------------------
alter table orders drop constraint if exists orders_currency_check;
alter table orders add constraint orders_currency_check check (currency ~ '^[A-Z]{3}$');
alter table orders drop constraint if exists orders_item_type_check;
alter table orders add constraint orders_item_type_check check (item_type in ('coin_pack', 'season_pass', 'subscription'));
alter table orders alter column amount type numeric(12,3);
alter table orders alter column vat_amount type numeric(12,3);
alter table orders add column if not exists country text;
alter table orders add column if not exists list_amount numeric(12,3);    -- before discounts
alter table orders add column if not exists bonus_ping int not null default 0;  -- promo / first-purchase bonus added on payment
alter table orders add column if not exists promotion_id uuid;
alter table orders add column if not exists subscription_id uuid;
alter table orders add column if not exists is_renewal boolean not null default false;
alter table orders add column if not exists save_card boolean not null default false;

-- ---------------------------------------------------------------------------
-- Weekly / yearly passes (all series), renewing automatically when the card is saved with Tap
-- ---------------------------------------------------------------------------
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  viewer_id uuid not null references viewers(id) on delete cascade,
  plan text not null check (plan in ('weekly', 'yearly')),
  status text not null default 'active' check (status in ('active', 'past_due', 'expired')),
  auto_renew boolean not null default false,
  current_period_end timestamptz not null,
  country text,
  currency text,
  amount numeric(12,3),
  tap_customer_id text,
  tap_card_id text,
  tap_agreement_id text,
  card_last4 text,
  renew_attempts int not null default 0,
  next_attempt_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists subscriptions_one_live on subscriptions (viewer_id) where status in ('active', 'past_due');
create index if not exists subscriptions_due on subscriptions (current_period_end) where status in ('active', 'past_due') and auto_renew;
alter table subscriptions enable row level security;

-- ---------------------------------------------------------------------------
-- Rewards, promotions, referrals, commissions
-- ---------------------------------------------------------------------------
create table if not exists reward_claims (
  id bigserial primary key,
  viewer_id uuid not null references viewers(id) on delete cascade,
  kind text not null check (kind in ('checkin')),
  day date not null,              -- Gulf date of the claim
  streak int not null,
  ping int not null,
  created_at timestamptz not null default now(),
  unique (viewer_id, kind, day)
);
alter table reward_claims enable row level security;

create table if not exists promotions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('bonus_ping', 'discount', 'free_ping')),
  value int not null check (value > 0),        -- % for bonus_ping / discount; Ping for free_ping
  applies_to text not null default 'packs' check (applies_to in ('packs', 'passes', 'all')),
  code text check (code is null or code ~ '^[A-Z0-9]{3,20}$'),   -- null = automatic for everyone eligible
  audience text not null default 'everyone' check (audience in ('everyone', 'new', 'first_purchase', 'lapsed')),
  countries text[] not null default '{}',     -- empty = every market
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions int check (max_redemptions is null or max_redemptions > 0),
  per_viewer int not null default 1 check (per_viewer between 1 and 100),
  redemptions int not null default 0,
  banner_ar text,
  banner_en text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists promotions_code on promotions (tenant_id, code) where code is not null;
alter table promotions enable row level security;

create table if not exists promotion_redemptions (
  id bigserial primary key,
  promotion_id uuid not null references promotions(id) on delete cascade,
  viewer_id uuid not null references viewers(id) on delete cascade,
  order_id uuid references orders(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (promotion_id, order_id)
);
create index if not exists promotion_redemptions_viewer on promotion_redemptions (promotion_id, viewer_id);
alter table promotion_redemptions enable row level security;

create table if not exists referral_rewards (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  referrer_id uuid not null references viewers(id) on delete cascade,
  friend_id uuid not null unique references viewers(id) on delete cascade,
  status text not null default 'joined' check (status in ('joined', 'rewarded', 'capped', 'blocked')),
  friend_ping int not null default 0,
  referrer_ping int not null default 0,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz
);
create index if not exists referral_rewards_referrer on referral_rewards (referrer_id, created_at desc);
alter table referral_rewards enable row level security;

create table if not exists affiliate_commissions (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  affiliate_id uuid not null references affiliates(id) on delete cascade,
  order_id uuid not null unique references orders(id) on delete cascade,
  viewer_id uuid not null references viewers(id) on delete cascade,
  base_amount numeric(12,3) not null,      -- paid amount excluding VAT
  currency text not null,
  commission numeric(12,3) not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'void')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists affiliate_commissions_affiliate on affiliate_commissions (affiliate_id, created_at desc);
alter table affiliate_commissions enable row level security;

-- ---------------------------------------------------------------------------
-- Money functions
-- ---------------------------------------------------------------------------

-- Free Ping (welcome, check-in, referral, promo code…), exactly once per key. Returns true when granted now.
create or replace function grant_reward(p_viewer uuid, p_ping int, p_kind text, p_key text)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_rows int;
begin
  if p_ping <= 0 then return false; end if;
  if p_ping > 100000 then raise exception 'reward too large'; end if;
  perform 1 from viewers where id = p_viewer for update;
  insert into wallet_ledger (viewer_id, delta, reason, ref_type, ref_id, idempotency_key)
  values (p_viewer, p_ping, 'grant', p_kind, left(p_key, 200), p_key)
  on conflict (idempotency_key) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- An active weekly / yearly pass opens every series.
create or replace function has_all_access(p_viewer uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from subscriptions
    where viewer_id = p_viewer and status in ('active', 'past_due') and current_period_end > now()
  );
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
  v_period interval;
  v_sub uuid;
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
  elsif o.item_type = 'subscription' then
    v_period := case o.item_ref when 'weekly' then interval '7 days' else interval '1 year' end;
    select id into v_sub from subscriptions where viewer_id = o.viewer_id and status in ('active', 'past_due') for update;
    if v_sub is null then
      insert into subscriptions (tenant_id, viewer_id, plan, status, auto_renew, current_period_end, country, currency, amount)
      select v.tenant_id, o.viewer_id, o.item_ref, 'active', o.save_card, now() + v_period, o.country, o.currency, o.amount
      from viewers v where v.id = o.viewer_id
      returning id into v_sub;
    else
      update subscriptions
        set plan = o.item_ref, status = 'active', renew_attempts = 0, next_attempt_at = null,
            current_period_end = greatest(current_period_end, now()) + v_period,
            country = o.country, currency = o.currency, amount = o.amount,
            auto_renew = case when o.is_renewal then auto_renew else o.save_card end,
            updated_at = now()
        where id = v_sub;
    end if;
    update orders set subscription_id = v_sub where id = p_order;
  end if;

  -- Promotion / first-purchase bonus Ping on top of the pack.
  if o.bonus_ping > 0 then
    insert into wallet_ledger (viewer_id, delta, reason, ref_type, ref_id, idempotency_key)
    values (o.viewer_id, o.bonus_ping, 'grant', 'promo', o.id::text, 'bonus:' || o.id::text);
  end if;
  if o.promotion_id is not null then
    insert into promotion_redemptions (promotion_id, viewer_id, order_id) values (o.promotion_id, o.viewer_id, o.id)
    on conflict do nothing;
    update promotions set redemptions = redemptions + 1 where id = o.promotion_id;
  end if;
  return 'ok';
end;
$$;

-- Redeem a free-Ping promo code once per viewer (and within its limits). Returns 'ok', 'used', 'limit' or 'invalid'.
create or replace function redeem_ping_code(p_viewer uuid, p_promotion uuid)
returns text
language plpgsql
set search_path = public
as $$
declare
  p promotions%rowtype;
  v_used int;
begin
  select * into p from promotions where id = p_promotion for update;
  if not found or not p.active or p.kind <> 'free_ping' then return 'invalid'; end if;
  if (p.starts_at is not null and now() < p.starts_at) or (p.ends_at is not null and now() > p.ends_at) then return 'invalid'; end if;
  if p.max_redemptions is not null and p.redemptions >= p.max_redemptions then return 'limit'; end if;
  select count(*) into v_used from promotion_redemptions where promotion_id = p.id and viewer_id = p_viewer;
  if v_used >= p.per_viewer then return 'used'; end if;
  insert into promotion_redemptions (promotion_id, viewer_id) values (p.id, p_viewer);
  update promotions set redemptions = redemptions + 1 where id = p.id;
  perform grant_reward(p_viewer, p.value, 'promo', 'code:' || p.id::text || ':' || p_viewer::text || ':' || (v_used + 1)::text);
  return 'ok';
end;
$$;

-- Welcome Ping for viewers who joined before this release.
insert into wallet_ledger (viewer_id, delta, reason, ref_type, ref_id, idempotency_key)
select v.id, coalesce(e.welcome_ping, 50), 'grant', 'welcome', v.id::text, 'welcome:' || v.id::text
from viewers v left join economy_settings e on e.tenant_id = v.tenant_id
where coalesce(e.welcome_ping, 50) > 0
on conflict (idempotency_key) do nothing;

revoke execute on function grant_reward(uuid, int, text, text) from public, anon, authenticated;
revoke execute on function has_all_access(uuid) from public, anon, authenticated;
revoke execute on function fulfil_order(uuid, text) from public, anon, authenticated;
revoke execute on function redeem_ping_code(uuid, uuid) from public, anon, authenticated;
grant execute on function grant_reward(uuid, int, text, text) to service_role;
grant execute on function has_all_access(uuid) to service_role;
grant execute on function fulfil_order(uuid, text) to service_role;
grant execute on function redeem_ping_code(uuid, uuid) to service_role;
