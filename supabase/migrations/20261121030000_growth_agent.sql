-- Growth agent (Suggest mode first): settings, the suggestion queue the team reviews, and how viewers
-- are picked for review. Plus quick-reply buttons on templates ("See my picks").

create table growth_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  enabled boolean not null default false,
  mode text not null default 'suggest' check (mode in ('suggest', 'autopilot')),
  daily_limit int not null default 50 check (daily_limit between 1 and 1000),
  min_inactive_days int not null default 2 check (min_inactive_days between 1 and 30),
  holdout_pct int not null default 10 check (holdout_pct between 0 and 50),
  run_hour int not null default 11 check (run_hour between 9 and 21), -- Gulf time
  last_run_at timestamptz,
  updated_by uuid references admin_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table growth_suggestions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  viewer_id uuid not null references viewers(id) on delete cascade,
  run_id uuid not null,
  status text not null check (status in ('pending', 'sent', 'rejected', 'failed', 'expired', 'holdout', 'skipped')),
  action text not null check (action in ('none', 'template', 'series_picks', 'flag')),
  series_id uuid references series(id) on delete set null,
  episode int,
  template_name text,
  options jsonb,                         -- series codes offered by series_picks
  reason text not null default '',
  priority int not null default 2,
  snapshot jsonb not null default '{}',  -- what the agent saw about the viewer
  decided_by uuid references admin_users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  sent_at timestamptz,
  error text,
  returned_at timestamptz,               -- first viewer activity after it was sent (or reviewed, for holdout)
  created_at timestamptz not null default now()
);
create index growth_suggestions_queue on growth_suggestions (tenant_id, status, created_at desc);
create index growth_suggestions_viewer on growth_suggestions (viewer_id, created_at desc);

alter table growth_settings enable row level security;
alter table growth_suggestions enable row level security;

alter table wa_templates add column button_type text not null default 'url' check (button_type in ('url', 'quick_reply'));

-- Viewers worth a look today: alerts on, last active between min and max days ago, nothing pending,
-- not reviewed recently, no marketing message in the last 20 hours.
create or replace function growth_candidates(p_tenant uuid, p_min_days int, p_max_days int, p_limit int)
returns table (viewer_id uuid, last_activity timestamptz)
language sql stable set search_path = public as $$
  with act as (
    select v.id as viewer_id,
           greatest(coalesce(v.last_inbound_at, 'epoch'::timestamptz),
                    coalesce((select max(p.updated_at) from progress p where p.viewer_id = v.id), 'epoch'::timestamptz)) as last_activity
    from viewers v
    where v.tenant_id = p_tenant
  )
  select a.viewer_id, a.last_activity
  from act a
  where a.last_activity between now() - make_interval(days => p_max_days) and now() - make_interval(days => p_min_days)
    and (select o.status from opt_ins o where o.viewer_id = a.viewer_id and o.topic = 'new_episodes' order by o.created_at desc limit 1) = 'in'
    and not exists (select 1 from growth_suggestions g where g.viewer_id = a.viewer_id
                    and (g.status = 'pending' or g.created_at > now() - make_interval(days => p_min_days)))
    and not exists (select 1 from wa_messages m where m.viewer_id = a.viewer_id and m.category = 'marketing'
                    and m.status <> 'failed' and m.created_at > now() - interval '20 hours')
  order by a.last_activity desc
  limit p_limit;
$$;
revoke execute on function growth_candidates(uuid, int, int, int) from public, anon, authenticated;
