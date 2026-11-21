-- Dashboard: users split by chat app (WhatsApp vs Telegram), same definitions as admin_dashboard_metrics
-- (total at the end of the period, new in it, active = any event in it, paying = a paid order in it).
create or replace function admin_channel_split(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns table (channel text, total_users bigint, new_users bigint, active_users bigint, paying_users bigint, revenue jsonb)
language sql
stable
set search_path = public
as $$
  with v as (
    select id, phone_hmac, created_at,
           case when phone_e164 like '+tg:%' then 'telegram' else 'whatsapp' end as channel
    from viewers
    where tenant_id = p_tenant and phone_e164 <> 'deleted'
  ),
  paid as (
    select v.channel, o.viewer_id, o.amount, o.currency
    from orders o join v on v.id = o.viewer_id
    where o.status = 'paid' and o.paid_at >= p_from and o.paid_at < p_to
  ),
  rev as (
    select channel, jsonb_object_agg(currency, total) as revenue
    from (select channel, currency, round(sum(amount)::numeric, 2) as total from paid group by channel, currency) x
    group by channel
  ),
  act as (
    select v.channel, count(distinct e.viewer_hmac) as n
    from events e join v on v.phone_hmac = e.viewer_hmac
    where e.tenant_id = p_tenant and e.created_at >= p_from and e.created_at < p_to
    group by v.channel
  )
  select c.channel,
    (select count(*) from v where v.channel = c.channel and v.created_at < p_to),
    (select count(*) from v where v.channel = c.channel and v.created_at >= p_from and v.created_at < p_to),
    coalesce((select n from act where act.channel = c.channel), 0),
    (select count(distinct viewer_id) from paid where paid.channel = c.channel),
    coalesce((select revenue from rev where rev.channel = c.channel), '{}'::jsonb)
  from (values ('whatsapp'), ('telegram')) as c(channel);
$$;

revoke execute on function admin_channel_split(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function admin_channel_split(uuid, timestamptz, timestamptz) to service_role;
