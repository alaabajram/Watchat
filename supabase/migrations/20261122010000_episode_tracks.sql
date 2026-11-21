-- Languages on one episode video: subtitle files and extra audio (e.g. an English dub), attached to the
-- episode's Cloudflare Stream video. The files themselves are kept in storage (R2) so they can be re-attached.
--   { "subs":  { "en": { "url": …, "path": …, "stream": "attached" | "pending" | "error", "error": … }, "ar": … },
--     "audio": { "en": { "url": …, "path": …, "stream": …, "audio_uid": … } } }
alter table episodes add column if not exists tracks jsonb not null default '{}'::jsonb;
