-- Home page content the team edits (Admin → Home page): texts, today images, Discover tiles; plus pictures and
-- labels on rooms and AI People, and where each room shows on Home.

alter table rooms
  add column if not exists image_path text,
  add column if not exists tag_ar text not null default '',
  add column if not exists tag_en text not null default '',
  add column if not exists home_slot text not null default 'tile' check (home_slot in ('hero', 'tile', 'wide', 'hidden'));

alter table ai_people
  add column if not exists image_path text,
  add column if not exists tag_ar text not null default '',
  add column if not exists tag_en text not null default '';

create table if not exists home_content (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table home_content enable row level security;
