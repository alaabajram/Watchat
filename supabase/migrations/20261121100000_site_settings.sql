-- Brand & site settings per label, edited in Admin → Settings → Brand & site (no Vercel variables needed):
-- site address, names, logos, colours, support contacts, and the Terms / Privacy / About pages.

create table if not exists site_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  app_url text,                    -- e.g. https://www.watchat.pro (used in personal links, payments, templates)
  name_ar text,
  name_en text,
  logo_on_light_url text,          -- wordmark for light backgrounds (home, pages)
  logo_on_dark_url text,           -- wordmark for dark backgrounds (admin sidebar, player)
  icon_url text,                   -- square icon (browser tab, app icon)
  color_primary text check (color_primary ~ '^#[0-9a-fA-F]{6}$'),
  color_accent text check (color_accent ~ '^#[0-9a-fA-F]{6}$'),
  support_email text,
  support_whatsapp text,           -- digits with country code
  business_email text,             -- partner / business enquiries
  updated_by uuid references admin_users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table site_settings enable row level security;

create table if not exists site_pages (
  tenant_id uuid not null references tenants(id) on delete cascade,
  slug text not null check (slug in ('terms', 'privacy', 'about')),
  title_ar text not null default '',
  title_en text not null default '',
  body_ar text not null default '',  -- simple formatting: # headings, - lists, **bold**, [links](https://…)
  body_en text not null default '',
  published boolean not null default false,
  updated_by uuid references admin_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, slug)
);
alter table site_pages enable row level security;
