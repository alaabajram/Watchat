-- My List: series a viewer saved with the bookmark button.
create table if not exists my_list (
  viewer_id uuid not null references viewers(id) on delete cascade,
  series_id uuid not null references series(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (viewer_id, series_id)
);
alter table my_list enable row level security;

-- Popularity for "Trending" and the TOP #n badge: distinct viewers who started an episode, per series.
create or replace function series_popularity(p_tenant uuid, p_since timestamptz)
returns table (series_id uuid, viewers bigint)
language sql
stable
set search_path = public
as $$
  select e.series_id, count(distinct e.viewer_hmac)
  from events e
  where e.tenant_id = p_tenant and e.name = 'episode_started' and e.series_id is not null and e.created_at >= p_since
  group by e.series_id;
$$;
revoke execute on function series_popularity(uuid, timestamptz) from public, anon, authenticated;
grant execute on function series_popularity(uuid, timestamptz) to service_role;
