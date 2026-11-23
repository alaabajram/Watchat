-- Story series: episodes made of scenes (image / video / sound + text) with choices and routing, played on the web.
-- A series is either "video" (Stream episodes, as before) or "story" (scenes built in Admin → Series → Story builder).

alter table series
  add column if not exists format text not null default 'video' check (format in ('video', 'story')),
  add column if not exists story_style text not null default 'visual_novel' check (story_style in ('visual_novel', 'chat', 'motion_comic', 'photo')),
  add column if not exists story_characters jsonb not null default '[]'::jsonb;

-- Each episode keeps the builder's draft and the published story (what viewers play) with a version number.
alter table episodes
  add column if not exists story_draft jsonb,
  add column if not exists story jsonb,
  add column if not exists story_version int not null default 0,
  add column if not exists story_ready boolean generated always as (story is not null) stored;

-- Where a viewer is in a story episode (resume) and the path they took.
create table if not exists story_progress (
  viewer_id uuid not null references viewers(id) on delete cascade,
  episode_id uuid not null references episodes(id) on delete cascade,
  series_id uuid not null references series(id) on delete cascade,
  scene_id text not null,
  history text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (viewer_id, episode_id)
);

-- What a viewer chose across the series (choices can set a flag that later episodes route on) and the endings they reached.
create table if not exists story_state (
  viewer_id uuid not null references viewers(id) on delete cascade,
  series_id uuid not null references series(id) on delete cascade,
  flags text[] not null default '{}',
  endings text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (viewer_id, series_id)
);

-- Premium choices a viewer paid for (once; replays are free).
create table if not exists story_purchases (
  viewer_id uuid not null references viewers(id) on delete cascade,
  series_id uuid not null references series(id) on delete cascade,
  choice_key text not null,
  price int not null,
  created_at timestamptz not null default now(),
  primary key (viewer_id, choice_key)
);

alter table story_progress enable row level security;
alter table story_state enable row level security;
alter table story_purchases enable row level security;

-- Pay for one premium choice with Ping. Returns 'ok', 'already' or 'insufficient'. The ledger stays append-only.
create or replace function buy_story_choice(p_viewer uuid, p_series uuid, p_key text, p_price int)
returns text
language plpgsql
set search_path = public
as $$
begin
  if p_price <= 0 then raise exception 'price must be positive'; end if;
  perform 1 from viewers where id = p_viewer for update; -- one money operation per viewer at a time
  if exists (select 1 from story_purchases where viewer_id = p_viewer and choice_key = p_key) then
    return 'already';
  end if;
  if wallet_balance(p_viewer) < p_price then return 'insufficient'; end if;
  insert into wallet_ledger (viewer_id, delta, reason, ref_type, ref_id, idempotency_key)
  values (p_viewer, -p_price, 'unlock', 'story_choice', p_key, 'story:' || p_viewer::text || ':' || p_key);
  insert into story_purchases (viewer_id, series_id, choice_key, price) values (p_viewer, p_series, p_key, p_price);
  return 'ok';
end;
$$;
revoke execute on function buy_story_choice(uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function buy_story_choice(uuid, uuid, text, int) to service_role;
