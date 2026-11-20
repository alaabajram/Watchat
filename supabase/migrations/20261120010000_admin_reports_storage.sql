-- Funnel report for the admin dashboard, and the public bucket for chat clips and posters.

-- Distinct viewers reaching each funnel stage in a period, optionally for one series and one traffic source.
-- p_source: 'ctwa_ad' | 'organic' | null (all)
create or replace function admin_funnel(p_tenant uuid, p_since timestamptz, p_series uuid, p_source text)
returns table (stage text, viewers bigint)
language sql
stable
set search_path = public
as $$
  with scoped as (
    select e.*
    from events e
    left join viewers v on v.phone_hmac = e.viewer_hmac and v.tenant_id = e.tenant_id
    left join traffic_sources ts on ts.id = v.first_source_id
    where e.tenant_id = p_tenant
      and e.created_at >= p_since
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

revoke execute on function admin_funnel(uuid, timestamptz, uuid, text) from public, anon, authenticated;
grant execute on function admin_funnel(uuid, timestamptz, uuid, text) to service_role;

-- Public bucket for small WhatsApp clips (H.264/AAC MP4 under 16 MB) and posters.
-- Public read is required because WhatsApp fetches the media by URL. Uploads use signed URLs only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800, array['video/mp4', 'image/jpeg', 'image/png', 'image/webp', 'text/vtt'])
on conflict (id) do nothing;
