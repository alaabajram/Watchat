-- Rooms page: each room gets a group (filter tabs) and its own button text; the weekly jackpot prize (Ping for
-- the week's top scorer in rooms with a right answer, paid once per week by the cron).

alter table rooms
  add column if not exists group_ar text not null default '',
  add column if not exists group_en text not null default '',
  add column if not exists cta_ar text not null default '',
  add column if not exists cta_en text not null default '';

alter table playground_settings
  add column if not exists weekly_prize_ping int not null default 0 check (weekly_prize_ping between 0 and 100000);
