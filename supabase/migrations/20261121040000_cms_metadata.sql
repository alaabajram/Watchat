-- Content team CMS: richer series details, artwork in every size the system uses, and scheduled episodes.
alter table series
  add column tagline_ar text,
  add column tagline_en text,
  add column genres text[] not null default '{}',
  add column tags text[] not null default '{}',
  add column cast_members jsonb not null default '[]'::jsonb,          -- [{ "name_ar", "name_en", "role" }]
  add column age_rating text check (age_rating in ('G', 'PG', 'PG-13', '15+', '18+')),
  add column banner_wide_url text,                                    -- 16:9 web hero
  add column banner_wa_url text,                                      -- 1.91:1 WhatsApp header images and templates
  add column square_url text;                                         -- 1:1 thumbnails and social

-- An episode reaches viewers when it is live and its release time (if any) has passed.
alter table episodes
  add column release_at timestamptz,
  add column thumb_url text,
  add column wa_size_bytes bigint;                                    -- size of the Arabic chat clip, for the 16 MB check
