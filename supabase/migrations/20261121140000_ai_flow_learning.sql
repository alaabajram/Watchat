-- "Build with AI" on every flow canvas (series, sequence, shared replies) learns from the team.
-- ai_flow_drafts: each draft the AI put on a canvas, the team's rating / note, and what the team changed
--   before publishing (filled when that canvas is next published).
-- ai_flow_lessons: the short house rules the AI follows, per label and canvas kind. Distilled by the AI from
--   ratings, notes and edits; the team can add, edit or remove rules in the AI panel.

create table if not exists ai_flow_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('series', 'sequence', 'shared')),
  target_id text not null,                 -- series id, sequence id, or 'shared'
  admin_id uuid,
  request text not null,
  graph jsonb not null,                    -- what the AI put on the canvas
  errors int not null default 0,
  rating smallint check (rating in (-1, 1)),
  feedback text,
  edits jsonb,                             -- what the team changed before publishing (learning.ts draftEdits)
  published_at timestamptz,
  learned_at timestamptz,                  -- folded into ai_flow_lessons
  created_at timestamptz not null default now()
);
create index if not exists ai_flow_drafts_target on ai_flow_drafts (tenant_id, kind, target_id, created_at desc);
create index if not exists ai_flow_drafts_unlearned on ai_flow_drafts (tenant_id, kind) where learned_at is null;
alter table ai_flow_drafts enable row level security;

create table if not exists ai_flow_lessons (
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('series', 'sequence', 'shared')),
  rules jsonb not null default '[]'::jsonb, -- [{ text, source: 'ai' | 'team', at }]
  signals int not null default 0,           -- how many ratings / notes / edits it has learned from
  updated_at timestamptz not null default now(),
  primary key (tenant_id, kind)
);
alter table ai_flow_lessons enable row level security;
