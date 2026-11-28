-- Heroes page: each AI person gets a group (filter tabs), a class line, a portrait badge word, a subtitle,
-- a feature chip, up to three stats, a button label and an optional voice note (audio greeting).

alter table ai_people
  add column if not exists group_ar text not null default '',
  add column if not exists group_en text not null default '',
  add column if not exists kicker_ar text not null default '',
  add column if not exists kicker_en text not null default '',
  add column if not exists badge_ar text not null default '',
  add column if not exists badge_en text not null default '',
  add column if not exists subtitle_ar text not null default '',
  add column if not exists subtitle_en text not null default '',
  add column if not exists feature_ar text not null default '',
  add column if not exists feature_en text not null default '',
  add column if not exists feature_emoji text not null default '',
  add column if not exists stats jsonb not null default '[]'::jsonb,
  add column if not exists cta_ar text not null default '',
  add column if not exists cta_en text not null default '',
  add column if not exists voice_path text;
