-- Telegram Stars (⭐, currency XTR): how Telegram viewers pay for Ping packs and passes inside Telegram.
-- One Stars price per item (no countries, no VAT: Telegram sells the Stars), plus a monthly pass that renews as a
-- Telegram Stars subscription (Telegram only renews every 30 days).

create table if not exists stars_prices (
  tenant_id uuid not null references tenants(id) on delete cascade,
  item text not null check (item ~ '^(pack:[0-9a-f-]{36}|series_pass|weekly|monthly|yearly)$'),
  stars int not null check (stars between 1 and 100000),
  primary key (tenant_id, item)
);
alter table stars_prices enable row level security;

-- Starting prices from the international USD prices at ~0.013 USD received per Star (editable in Pricing & Ping).
insert into stars_prices (tenant_id, item, stars)
select tenant_id, item, stars from (
  select mp.tenant_id, mp.item,
    (case mp.item when 'weekly' then 700 when 'yearly' then 13900 when 'series_pass' then 620
       else (ceil(mp.price / 0.013 / 10) * 10)::int end) as stars
  from market_prices mp where mp.country = 'ZZ'
) x
on conflict do nothing;
insert into stars_prices (tenant_id, item, stars) select id, 'monthly', 2200 from tenants on conflict do nothing;

alter table orders drop constraint if exists orders_gateway_check;
alter table orders add constraint orders_gateway_check check (gateway in ('tap', 'dcb', 'cash', 'telegram'));

alter table subscriptions drop constraint if exists subscriptions_plan_check;
alter table subscriptions add constraint subscriptions_plan_check check (plan in ('weekly', 'monthly', 'yearly'));
-- Telegram Stars subscriptions: the charge id to cancel / restart renewal.
alter table subscriptions add column if not exists tg_charge_id text;
alter table subscriptions add column if not exists tg_user_id bigint;

-- Pay orders: weekly 7 days, monthly 30 days (a Stars subscription period), yearly 1 year.
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
    v_period := case o.item_ref when 'weekly' then interval '7 days' when 'monthly' then interval '30 days' else interval '1 year' end;
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
revoke execute on function fulfil_order(uuid, text) from public, anon, authenticated;
grant execute on function fulfil_order(uuid, text) to service_role;
