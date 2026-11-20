-- WhatsApp spend meter: what each sent message costs, by category, market and what sent it.
-- Meta reports per message whether it is billable and why not (free entry point after a
-- Click-to-WhatsApp ad, free customer-service window). Costs are worked out from the rate card in
-- src/lib/spend/meter.ts (admins can override rates), so past months recost if the rates change.

alter table wa_messages
  add column if not exists source text,          -- bot | flow | sequence | campaign | growth | admin
  add column if not exists market text,          -- rate-card market from the number's country code (no phone stored)
  add column if not exists billable boolean,     -- from Meta's status webhook; null until it arrives
  add column if not exists pricing_type text;    -- regular | free_customer_service | free_entry_point

create index if not exists wa_messages_wa_id on wa_messages (wa_message_id);
create index if not exists wa_messages_out_created on wa_messages (created_at) where direction = 'out';

create table if not exists spend_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  monthly_budget_usd numeric(12,2),              -- null = no budget
  alert_pct int not null default 80 check (alert_pct between 10 and 100),
  stop_marketing_at_budget boolean not null default false,
  rates jsonb,                                   -- overrides: {"SA":{"marketing":0.066,...}}
  updated_by uuid references admin_users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table spend_settings enable row level security;

-- Message counts grouped for the meter (one row per day × source × market × category × template × state).
create or replace function wa_spend_groups(p_tenant uuid, p_since timestamptz, p_until timestamptz)
returns table (day date, source text, market text, category text, template_name text, state text, n bigint)
language sql stable as $$
  select
    (m.created_at at time zone 'Asia/Dubai')::date as day,
    coalesce(m.source, case when m.kind = 'template' then 'flow' else 'bot' end) as source,
    coalesce(m.market, 'OTHER') as market,
    coalesce(m.category, 'service') as category,
    m.template_name,
    case
      when m.status = 'failed' then 'failed'
      when m.billable is false or m.pricing_type like 'free%' or m.category = 'referral_conversion' then coalesce(m.pricing_type, 'free')
      when m.billable is true then 'billable'
      else 'pending'
    end as state,
    count(*) as n
  from wa_messages m
  join viewers v on v.id = m.viewer_id
  where v.tenant_id = p_tenant
    and m.direction = 'out'
    and m.created_at >= p_since
    and m.created_at < p_until
  group by 1, 2, 3, 4, 5, 6;
$$;
revoke execute on function wa_spend_groups(uuid, timestamptz, timestamptz) from public, anon, authenticated;
