-- Sequence flows: a sequence is now built on the flow builder canvas.
-- The sequences row keeps its trigger (stopped mid-series / inactive / finished series), delay, series
-- and active switch — sequence_candidates() is unchanged — and gains the canvas: draft and published graph.
-- Sequences without a graph keep working as single-template sequences (template_name).

alter table sequences
  add column if not exists draft jsonb,
  add column if not exists graph jsonb,
  add column if not exists version int not null default 0,
  add column if not exists published_at timestamptz,
  add column if not exists note text;
alter table sequences alter column template_name drop not null;

-- One run per (sequence, viewer, moment): where the viewer is on the canvas.
create table if not exists sequence_runs (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  sequence_id uuid not null references sequences(id) on delete cascade,
  viewer_id uuid not null references viewers(id) on delete cascade,
  ref text not null,                       -- the moment that started it (same as sequence_sends.ref)
  series_id uuid references series(id) on delete set null,
  episode_number int,
  version int not null,
  node_id text not null,
  status text not null check (status in ('wait', 'running', 'done', 'blocked')),
  resume_at timestamptz,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sequence_id, viewer_id, ref)
);
create index if not exists sequence_runs_due on sequence_runs (resume_at) where status = 'wait';
create index if not exists sequence_runs_by_sequence on sequence_runs (sequence_id, status);
alter table sequence_runs enable row level security; -- server (service role) only, like the other tables
