-- Studio: producing story series with Claude (+ OpenArt) and reviewing them in Admin before publishing.

-- Where each episode is in production, its brief and the review notes.
create table if not exists studio_items (
  episode_id uuid primary key references episodes(id) on delete cascade,
  series_id uuid not null references series(id) on delete cascade,
  tenant_id uuid not null,
  stage text not null default 'brief' check (stage in ('brief', 'writing', 'script_review', 'pictures', 'final_check', 'approved', 'published')),
  brief text,
  notes jsonb not null default '[]'::jsonb,
  credits_used int not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists studio_items_tenant on studio_items (tenant_id, stage);

-- The series bible Claude writes from: style line, dialect, rules and each character's locked look.
alter table series add column if not exists story_bible jsonb not null default '{}'::jsonb;

-- OpenArt credit budget per label (Claude asks before every generation).
create table if not exists studio_settings (
  tenant_id uuid primary key,
  monthly_credits int not null default 24000,
  episode_credits int not null default 2500,
  usd_per_credit numeric not null default 0.0015,
  updated_at timestamptz not null default now()
);

-- Every reservation Claude made (model, credits), for the budget and the cost per episode.
create table if not exists studio_credit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  series_id uuid references series(id) on delete set null,
  episode_id uuid references episodes(id) on delete set null,
  model text not null,
  kind text not null,
  credits int not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists studio_credit_log_month on studio_credit_log (tenant_id, created_at desc);

-- Keys for the Watchat connector in Claude (the connector address carries the key; only its hash is stored).
create table if not exists studio_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  admin_id uuid not null references admin_users(id) on delete cascade,
  label text,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table studio_items enable row level security;
alter table studio_settings enable row level security;
alter table studio_credit_log enable row level security;
alter table studio_tokens enable row level security;
