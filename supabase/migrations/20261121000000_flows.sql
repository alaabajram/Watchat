-- Visual flow builder: one flow per series (draft + published versions), each viewer's place in it,
-- and a media library of chat images and video cuts per series.

create table media_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  series_id uuid references series(id) on delete cascade,   -- null = shared by all series
  kind text not null check (kind in ('image', 'video')),
  name text not null,
  url text not null,
  path text not null,
  mime text,
  size_bytes bigint,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index media_assets_series on media_assets (tenant_id, series_id, created_at desc);

create table flows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  series_id uuid not null unique references series(id) on delete cascade,
  draft jsonb not null,
  draft_updated_at timestamptz not null default now(),
  draft_updated_by uuid references admin_users(id) on delete set null,
  published_version_id uuid,
  created_at timestamptz not null default now()
);

create table flow_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  flow_id uuid not null references flows(id) on delete cascade,
  version int not null,
  graph jsonb not null,
  note text,
  published_by uuid references admin_users(id) on delete set null,
  published_at timestamptz not null default now(),
  unique (flow_id, version)
);

alter table flows add constraint flows_published_version_fk foreign key (published_version_id) references flow_versions(id) on delete set null;

-- Where each viewer is in a flow: waiting for a tap, waiting for time (resume_at), or finished.
create table flow_runs (
  viewer_id uuid primary key references viewers(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  series_id uuid not null references series(id) on delete cascade,
  version_id uuid not null references flow_versions(id) on delete cascade,
  node_id text not null,
  status text not null check (status in ('input', 'wait', 'running', 'done', 'blocked')),
  resume_at timestamptz,
  updated_at timestamptz not null default now()
);
create index flow_runs_due on flow_runs (resume_at) where status = 'wait';

-- WhatsApp's 24-hour window is counted from the viewer's last WhatsApp message (not web visits).
alter table viewers add column last_inbound_at timestamptz;

alter table media_assets enable row level security;
alter table flows enable row level security;
alter table flow_versions enable row level security;
alter table flow_runs enable row level security;
