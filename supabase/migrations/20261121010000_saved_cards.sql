-- "My cards": cards (or groups of connected cards) a label saves from the flow builder to reuse in any series.
create table saved_cards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  block jsonb not null,                -- { v: 1, nodes, edges } with positions relative to the block
  card_count int not null,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index saved_cards_tenant on saved_cards (tenant_id, created_at desc);
alter table saved_cards enable row level security;
