-- Channels (WhatsApp / Telegram) on flows, shared replies and sequences.
--   both      = one flow for both chat apps (the default)
--   whatsapp  = the WhatsApp half of a pair (the series / label also has a separate Telegram flow)
--   telegram  = runs for Telegram viewers only
-- A series (or the shared replies) has either one "both" flow, or a "whatsapp" + "telegram" pair.

alter table flows add column if not exists channel text not null default 'both' check (channel in ('both', 'whatsapp', 'telegram'));
alter table flows drop constraint if exists flows_series_id_key;
create unique index if not exists flows_series_channel on flows (series_id, channel);

alter table shared_flows add column if not exists channel text not null default 'both' check (channel in ('both', 'whatsapp', 'telegram'));
alter table shared_flows drop constraint if exists shared_flows_pkey;
alter table shared_flows add primary key (tenant_id, channel);

-- Sequences: who they run for (Telegram-only sequences are free messages; WhatsApp ones use paid templates).
alter table sequences add column if not exists channel text not null default 'both' check (channel in ('both', 'whatsapp', 'telegram'));

-- CTR per chat app: the same meters as ctr_flow_cards / ctr_messages, split by the viewer's chat app.
create or replace function ctr_flow_cards_by_channel(p_tenant uuid, p_since timestamptz)
returns table (series_id text, node_id text, channel text, reached bigint, tapped bigint, opened bigint)
language sql
stable
set search_path = public
as $$
  with v as (
    select id, phone_hmac, case when phone_e164 like '+tg:%' then 'telegram' else 'whatsapp' end as channel
    from viewers where tenant_id = p_tenant
  ),
  reached as (
    select m.ref_id as series_id, m.node_id, v.channel, count(distinct m.viewer_id) as n
    from wa_messages m join v on v.id = m.viewer_id
    where m.direction = 'out' and m.ref_type = 'flow' and m.node_id is not null and m.status <> 'failed' and m.created_at >= p_since
    group by 1, 2, 3
  ),
  taps as (
    select e.series_id::text as series_id, e.props->>'node' as node_id, v.channel, count(distinct e.viewer_hmac) as n
    from events e join v on v.phone_hmac = e.viewer_hmac
    where e.tenant_id = p_tenant and e.name = 'flow_tap' and e.created_at >= p_since
    group by 1, 2, 3
  ),
  opens as (
    select l.ref_id as series_id, l.node_id, v.channel, count(distinct l.viewer_id) as n
    from link_tokens l join v on v.id = l.viewer_id
    where l.ref_type = 'flow' and l.node_id is not null and l.opened_at is not null and l.created_at >= p_since
    group by 1, 2, 3
  )
  select r.series_id, r.node_id, r.channel, r.n, coalesce(t.n, 0), coalesce(o.n, 0)
  from reached r
  left join taps t on t.series_id = r.series_id and t.node_id = r.node_id and t.channel = r.channel
  left join opens o on o.series_id = r.series_id and o.node_id = r.node_id and o.channel = r.channel;
$$;

create or replace function ctr_messages_by_channel(p_tenant uuid, p_since timestamptz)
returns table (ref_type text, ref_id text, channel text, sent bigint, clicked bigint)
language sql
stable
set search_path = public
as $$
  with v as (
    select id, case when phone_e164 like '+tg:%' then 'telegram' else 'whatsapp' end as channel
    from viewers where tenant_id = p_tenant
  ),
  sent as (
    select m.ref_type, m.ref_id, v.channel, count(*) as n
    from wa_messages m join v on v.id = m.viewer_id
    where m.direction = 'out' and m.ref_type in ('sequence', 'campaign') and m.status <> 'failed' and m.created_at >= p_since
    group by 1, 2, 3
  ),
  clicks as (
    select l.ref_type, l.ref_id, v.channel, count(*) as n
    from link_tokens l join v on v.id = l.viewer_id
    where l.ref_type in ('sequence', 'campaign') and l.created_at >= p_since and l.opened_at is not null
    group by 1, 2, 3
  )
  select s.ref_type, s.ref_id, s.channel, s.n, coalesce(c.n, 0)
  from sent s left join clicks c on c.ref_type = s.ref_type and c.ref_id = s.ref_id and c.channel = s.channel;
$$;

revoke execute on function ctr_flow_cards_by_channel(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function ctr_messages_by_channel(uuid, timestamptz) from public, anon, authenticated;
grant execute on function ctr_flow_cards_by_channel(uuid, timestamptz) to service_role;
grant execute on function ctr_messages_by_channel(uuid, timestamptz) to service_role;
