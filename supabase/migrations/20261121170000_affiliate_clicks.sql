-- Partner link clicks are counted atomically (two clicks at once must not overwrite each other).
create or replace function bump_affiliate_click(p_affiliate uuid)
returns void
language sql
set search_path = public
as $$
  update affiliates set clicks = clicks + 1 where id = p_affiliate;
$$;
revoke execute on function bump_affiliate_click(uuid) from public, anon, authenticated;
grant execute on function bump_affiliate_click(uuid) to service_role;
