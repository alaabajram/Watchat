-- CTR meters: which sequence, campaign or flow card sent each message and link, and whether the
-- viewer clicked (opened the link) or tapped a button.

alter table wa_messages
  add column if not exists ref_type text,   -- sequence | campaign | flow | growth
  add column if not exists ref_id text,     -- sequence id, campaign id, series id (flow) or suggestion id
  add column if not exists node_id text;    -- flow card
create index if not exists wa_messages_ref on wa_messages (ref_type, ref_id, created_at) where ref_type is not null;

alter table link_tokens
  add column if not exists ref_type text,
  add column if not exists ref_id text,
  add column if not exists node_id text,
  add column if not exists opened_at timestamptz;  -- first open by the link's owner
create index if not exists link_tokens_ref on link_tokens (ref_type, ref_id, created_at) where ref_type is not null;

create index if not exists events_flow_tap on events (tenant_id, name, created_at) where name = 'flow_tap';

-- Sequences and campaigns: per message sent, how many arrived, were read, were clicked, and led to watching within 48 h.
create or replace function ctr_messages(p_tenant uuid, p_since timestamptz)
returns table (ref_type text, ref_id text, sent bigint, delivered bigint, read bigint, failed bigint, clicked bigint, watched bigint)
language sql stable as $$
  with msgs as (
    select m.ref_type, m.ref_id, m.viewer_id, m.status, m.created_at
    from wa_messages m join viewers v on v.id = m.viewer_id
    where v.tenant_id = p_tenant and m.direction = 'out' and m.ref_type in ('sequence', 'campaign') and m.created_at >= p_since
  ),
  clicks as (
    select l.ref_type, l.ref_id, count(*) as n
    from link_tokens l join viewers v on v.id = l.viewer_id
    where v.tenant_id = p_tenant and l.ref_type in ('sequence', 'campaign') and l.created_at >= p_since and l.opened_at is not null
    group by 1, 2
  )
  select
    m.ref_type, m.ref_id,
    count(*) filter (where m.status <> 'failed') as sent,
    count(*) filter (where m.status in ('delivered', 'read')) as delivered,
    count(*) filter (where m.status = 'read') as read,
    count(*) filter (where m.status = 'failed') as failed,
    coalesce(max(c.n), 0) as clicked,
    count(*) filter (where m.status <> 'failed' and exists (
      select 1 from progress p where p.viewer_id = m.viewer_id and p.updated_at > m.created_at and p.updated_at <= m.created_at + interval '48 hours'
    )) as watched
  from msgs m
  left join clicks c on c.ref_type = m.ref_type and c.ref_id = m.ref_id
  group by 1, 2;
$$;

-- Flow cards: viewers who got each card, and how many tapped one of its buttons or opened its link.
create or replace function ctr_flow_cards(p_tenant uuid, p_since timestamptz)
returns table (series_id text, node_id text, reached bigint, tapped bigint, opened bigint)
language sql stable as $$
  with reached as (
    select m.ref_id as series_id, m.node_id, count(distinct m.viewer_id) as n
    from wa_messages m join viewers v on v.id = m.viewer_id
    where v.tenant_id = p_tenant and m.direction = 'out' and m.ref_type = 'flow' and m.node_id is not null
      and m.status <> 'failed' and m.created_at >= p_since
    group by 1, 2
  ),
  taps as (
    select e.series_id::text as series_id, e.props->>'node' as node_id, count(distinct e.viewer_hmac) as n
    from events e
    where e.tenant_id = p_tenant and e.name = 'flow_tap' and e.created_at >= p_since
    group by 1, 2
  ),
  opens as (
    select l.ref_id as series_id, l.node_id, count(distinct l.viewer_id) as n
    from link_tokens l join viewers v on v.id = l.viewer_id
    where v.tenant_id = p_tenant and l.ref_type = 'flow' and l.node_id is not null and l.opened_at is not null and l.created_at >= p_since
    group by 1, 2
  )
  select r.series_id, r.node_id, r.n as reached, coalesce(t.n, 0) as tapped, coalesce(o.n, 0) as opened
  from reached r
  left join taps t on t.series_id = r.series_id and t.node_id = r.node_id
  left join opens o on o.series_id = r.series_id and o.node_id = r.node_id;
$$;

revoke execute on function ctr_messages(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function ctr_flow_cards(uuid, timestamptz) from public, anon, authenticated;
