-- Admin dashboard: headline metrics and the funnel for any date range [p_from, p_to).
-- Read-only, tenant-scoped. Source filter: 'ctwa_ad' / other traffic types, or 'organic' (no first source).

create or replace function public.admin_dashboard_metrics(
  p_tenant uuid, p_from timestamptz, p_to timestamptz, p_series uuid, p_source text
)
returns table (
  total_users bigint,     -- all viewers who joined before the end of the range
  new_users bigint,       -- joined inside the range
  active_users bigint,    -- did anything (chat, watch, open a link…) inside the range
  paying_users bigint,    -- had a paid order inside the range
  revenue jsonb           -- {"AED": 123.45, "SAR": 10}
)
language sql
stable
set search_path to 'public'
as $$
  with v as (
    select v.*
    from viewers v
    left join traffic_sources ts on ts.id = v.first_source_id
    where v.tenant_id = p_tenant
      and (p_source is null
           or (p_source = 'organic' and v.first_source_id is null)
           or ts.type = p_source)
  ),
  paid as (
    select o.viewer_id, o.amount, o.currency
    from orders o
    join v on v.id = o.viewer_id
    where o.status = 'paid' and o.paid_at >= p_from and o.paid_at < p_to
      and (p_series is null or (o.item_type = 'season_pass' and o.item_ref = p_series::text) or o.item_type <> 'season_pass')
  ),
  rev as (
    select coalesce(jsonb_object_agg(currency, total), '{}'::jsonb) as revenue
    from (select currency, round(sum(amount)::numeric, 2) as total from paid group by currency) x
  )
  select
    (select count(*) from v where v.created_at < p_to),
    (select count(*) from v where v.created_at >= p_from and v.created_at < p_to),
    (select count(distinct e.viewer_hmac)
       from events e join v on v.phone_hmac = e.viewer_hmac
      where e.tenant_id = p_tenant and e.created_at >= p_from and e.created_at < p_to
        and (p_series is null or e.series_id = p_series)),
    (select count(distinct viewer_id) from paid),
    (select revenue from rev);
$$;

-- Same stages as admin_funnel, with an end date.
create or replace function public.admin_funnel_range(
  p_tenant uuid, p_from timestamptz, p_to timestamptz, p_series uuid, p_source text
)
returns table (stage text, viewers bigint)
language sql
stable
set search_path to 'public'
as $$
  with scoped as (
    select e.*
    from events e
    left join viewers v on v.phone_hmac = e.viewer_hmac and v.tenant_id = e.tenant_id
    left join traffic_sources ts on ts.id = v.first_source_id
    where e.tenant_id = p_tenant
      and e.created_at >= p_from and e.created_at < p_to
      and (p_series is null or e.series_id = p_series or e.series_id is null)
      and (p_source is null
           or (p_source = 'organic' and v.first_source_id is null)
           or ts.type = p_source)
  ),
  last_ep as (
    select s.id as series_id, max(ep.number) as last_number
    from series s join episodes ep on ep.series_id = s.id and ep.status = 'live'
    group by s.id
  )
  select '1 Chat started', count(distinct viewer_hmac) from scoped where name = 'chat_started'
  union all
  select '2 Episode 1 finished', count(distinct viewer_hmac) from scoped where name = 'wa_episode_done' and episode_number = 1
  union all
  select '3 Web link opened', count(distinct viewer_hmac) from scoped where name = 'link_opened'
  union all
  select '4 Reached episode 9', count(distinct viewer_hmac) from scoped where name = 'episode_started' and episode_number >= 9
  union all
  select '5 Saw paywall', count(distinct viewer_hmac) from scoped where name = 'paywall_viewed'
  union all
  select '6 Paid', count(distinct viewer_hmac) from scoped where name = 'order_paid'
  union all
  select '7 Finished series', count(distinct sc.viewer_hmac)
    from scoped sc join last_ep le on le.series_id = sc.series_id
   where sc.name = 'episode_completed' and sc.episode_number = le.last_number
  union all
  select '8 Started another series', count(*) from (
    select viewer_hmac from scoped where name = 'chat_started' group by viewer_hmac having count(distinct series_id) > 1
  ) x;
$$;

revoke all on function public.admin_dashboard_metrics(uuid, timestamptz, timestamptz, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_funnel_range(uuid, timestamptz, timestamptz, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_dashboard_metrics(uuid, timestamptz, timestamptz, uuid, text) to service_role;
grant execute on function public.admin_funnel_range(uuid, timestamptz, timestamptz, uuid, text) to service_role;
