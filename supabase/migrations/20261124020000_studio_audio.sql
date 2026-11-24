-- Studio sound: the team's OpenArt audio rates (credits per second by kind: music, sfx, voice, lipsync).
-- Empty = the starting values in src/lib/studio/budget.ts (AUDIO_RATES).
alter table studio_settings add column if not exists audio_rates jsonb not null default '{}'::jsonb;
