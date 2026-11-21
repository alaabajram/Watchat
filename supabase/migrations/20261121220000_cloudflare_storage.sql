-- Moving files from the Supabase "media" bucket to Cloudflare (Images for pictures, R2 for other files).
-- Links to uploaded files are stored in many places (series artwork, episodes, flow cards and versions,
-- the media library, logos …), so these two helpers scan every text / JSON column instead of a fixed list.
-- Logs and the append-only ledger are left untouched.

create or replace function media_url_hits(p_like text)
returns table (url text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and c.data_type in ('text', 'character varying', 'json', 'jsonb')
      and c.table_name not in ('wallet_ledger', 'audit_log', 'events', 'wa_messages', 'wa_inbound')
  loop
    return query execute format(
      'select distinct (regexp_matches(%I::text, %L, %L))[1] from %I where %I::text like %L',
      r.column_name, '(https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/media/[^"''\s)\\]+)', 'gi',
      r.table_name, r.column_name, p_like
    );
  end loop;
end;
$$;

create or replace function replace_media_url(p_old text, p_new text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer;
  total integer := 0;
begin
  if p_old not like 'https://%.supabase.co/storage/v1/object/public/media/%' or p_new not like 'https://%' then
    raise exception 'not a media link';
  end if;
  for r in
    select c.table_name, c.column_name, c.data_type
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and c.data_type in ('text', 'character varying', 'json', 'jsonb')
      and c.table_name not in ('wallet_ledger', 'audit_log', 'events', 'wa_messages', 'wa_inbound')
  loop
    execute format(
      'update %I set %I = replace(%I::text, %L, %L)::%s where position(%L in %I::text) > 0',
      r.table_name, r.column_name, r.column_name, p_old, p_new,
      case r.data_type when 'character varying' then 'varchar' else r.data_type end,
      p_old, r.column_name
    );
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  return total;
end;
$$;

revoke execute on function media_url_hits(text) from public, anon, authenticated;
revoke execute on function replace_media_url(text, text) from public, anon, authenticated;
grant execute on function media_url_hits(text) to service_role;
grant execute on function replace_media_url(text, text) to service_role;
