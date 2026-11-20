-- Fix: the template name check used {1,512}, which Postgres regexes reject (repetition counts max out
-- at 255), so every insert into wa_templates failed. Same rule, written so Postgres accepts it.
alter table wa_templates drop constraint if exists wa_templates_name_check;
alter table wa_templates add constraint wa_templates_name_check check (name ~ '^[a-z0-9_]+$' and char_length(name) <= 512);
