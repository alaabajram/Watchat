-- Playground phase 2: streak rewards, the morning reminder (web push) and its once-a-day log.

alter table playground_settings
  add column if not exists streak_rewards jsonb not null default '{"3": 5, "7": 15, "14": 25, "30": 60}'::jsonb,
  add column if not exists morning_push boolean not null default true,
  add column if not exists morning_hour int not null default 8 check (morning_hour between 5 and 12);

-- One morning reminder per viewer per day (claimed before sending, so two cron ticks never double-send).
create table play_pushes (
  viewer_id uuid not null references viewers(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  day date not null,
  kind text not null default 'morning' check (kind in ('morning')),
  delivered boolean,
  created_at timestamptz not null default now(),
  primary key (viewer_id, kind, day)
);
create index play_pushes_day_idx on play_pushes (tenant_id, day);
alter table play_pushes enable row level security;

create index if not exists room_answers_correct_idx on room_answers (viewer_id, created_at) where correct;
