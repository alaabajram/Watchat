-- Studio series artwork: a per-series OpenArt credit cap for posters / banners / square, and pictures Claude made
-- for a live series' filled slots, waiting for the team's "Use it" (one per slot, latest wins).
alter table studio_settings add column if not exists artwork_credits int not null default 400;
alter table series add column if not exists studio_artwork jsonb not null default '{}'::jsonb;
