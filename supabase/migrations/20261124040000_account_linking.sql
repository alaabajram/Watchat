-- One account, many ways in: a viewer can add a phone number, an email and Telegram to the same account, and two
-- accounts of the same person can be merged into one.

-- Extra sign-ins of an account (its own phone_hmac is the first one). Key: the same HMAC the sign-in uses
-- (phone: phoneHmac, Telegram: phoneHmac of "tg:<id>", email: HMAC of "email:<address>").
create table if not exists viewer_logins (
  tenant_id uuid not null,
  hmac text not null,
  kind text not null check (kind in ('phone', 'telegram', 'email')),
  label text, -- masked, for the Profile list ("+97150 ••• 4567", "a•••@gmail.com")
  viewer_id uuid not null references viewers(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, hmac)
);
create index if not exists viewer_logins_viewer on viewer_logins (viewer_id);
alter table viewer_logins enable row level security;

-- A merged account points at the one it became.
alter table viewers add column if not exists merged_into uuid references viewers(id);
alter table viewers add column if not exists merged_at timestamptz;

-- Short-lived requests: "connect Telegram" (opened in the bot) and "merge these two accounts?" (confirmed on the web).
create table if not exists link_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  viewer_id uuid not null references viewers(id),
  kind text not null check (kind in ('telegram', 'merge')),
  token_hash text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists link_requests_viewer on link_requests (viewer_id, created_at desc);
alter table link_requests enable row level security;

-- Email links can add an email to a signed-in account instead of signing in.
alter table email_logins add column if not exists link_viewer_id uuid references viewers(id);

-- The ledger stays append-only: a merge moves the balance with two 'merge' entries.
alter table wallet_ledger drop constraint if exists wallet_ledger_reason_check;
alter table wallet_ledger add constraint wallet_ledger_reason_check check (reason in ('purchase', 'unlock', 'grant', 'refund', 'expiry', 'merge'));

-- Move everything of p_from into p_into, in one transaction. Rows the kept account already has (same episode,
-- same pass, same list entry…) stay as the kept account's; the duplicates of p_from are dropped.
create or replace function merge_viewers(p_from uuid, p_into uuid) returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_tenant uuid;
  v_kind text;
  v_hmac text;
  v_phone text;
  v_bal int;
  r record;
  i int;
  tabs text[] := array['sessions','entitlements','progress','story_progress','story_state','story_purchases','my_list','orders','subscriptions',
    'promotion_redemptions','reward_claims','push_subscriptions','push_messages','opt_ins','flow_runs','chat_state','campaign_sends',
    'sequence_runs','sequence_sends','growth_suggestions','link_tokens','spend_confirmations','affiliate_commissions','wa_messages',
    'referral_rewards','referral_rewards','link_requests'];
  cols text[] := array['viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id',
    'viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id',
    'viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id',
    'friend_id','referrer_id','viewer_id'];
begin
  if p_from = p_into then raise exception 'same account'; end if;
  select tenant_id, phone_hmac, phone_e164 into v_tenant, v_hmac, v_phone from viewers where id = p_from and merged_into is null for update;
  if not found then raise exception 'account to merge not found'; end if;
  perform 1 from viewers where id = p_into and tenant_id = v_tenant and merged_into is null for update;
  if not found then raise exception 'account to keep not found'; end if;

  v_bal := wallet_balance(p_from);
  if v_bal <> 0 then
    insert into wallet_ledger (viewer_id, delta, reason, ref_type, ref_id, idempotency_key) values
      (p_from, -v_bal, 'merge', 'viewer', p_into::text, 'merge-out:' || p_from::text),
      (p_into, v_bal, 'merge', 'viewer', p_from::text, 'merge-in:' || p_from::text);
  end if;

  for i in 1 .. array_length(tabs, 1) loop
    if to_regclass(tabs[i]) is null then continue; end if;
    for r in execute format('select ctid from %I where %I = $1', tabs[i], cols[i]) using p_from loop
      begin
        execute format('update %I set %I = $1 where ctid = $2', tabs[i], cols[i]) using p_into, r.ctid;
      exception when unique_violation then
        execute format('delete from %I where ctid = $1', tabs[i]) using r.ctid;
      end;
    end loop;
  end loop;

  update viewers set referred_by = p_into where referred_by = p_from and id <> p_into;
  update viewers set merged_into = p_into where merged_into = p_from;

  -- Every way into p_from now opens p_into.
  update viewer_logins set viewer_id = p_into where viewer_id = p_from;
  v_kind := case when v_phone like '+tg:%' then 'telegram' when v_phone like '+em:%' then 'email' else 'phone' end;
  insert into viewer_logins (tenant_id, hmac, kind, label, viewer_id)
  values (v_tenant, v_hmac, v_kind, case when v_kind = 'phone' then left(v_phone, 6) || ' ••• ' || right(v_phone, 4) else null end, p_into)
  on conflict (tenant_id, hmac) do update set viewer_id = excluded.viewer_id;

  update viewers set merged_into = p_into, merged_at = now() where id = p_from;
  return jsonb_build_object('ping', v_bal);
end;
$$;
revoke all on function merge_viewers(uuid, uuid) from public, anon, authenticated;
