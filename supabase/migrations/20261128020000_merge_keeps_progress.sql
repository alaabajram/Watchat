-- Account merge keeps everything, and the further progress where both accounts played the same thing:
-- episodes (finished / later position), story episodes (more scenes seen), story flags and endings (both),
-- room rounds (a right answer wins), AI People chats (one chat, both histories), streak days (combined),
-- star sign, card draws, readings and morning-reminder log. Same function as before otherwise.

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
    'referral_rewards','referral_rewards','link_requests',
    'room_answers','daily_draws','tarot_readings','ai_chats','habit_days','play_pushes'];
  cols text[] := array['viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id',
    'viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id',
    'viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id',
    'friend_id','referrer_id','viewer_id',
    'viewer_id','viewer_id','viewer_id','viewer_id','viewer_id','viewer_id'];
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

  -- Where both accounts have progress on the same thing, the kept account gets the further one before the move
  -- below drops the duplicate.
  -- Episodes: watched to the end wins, else the later position.
  if to_regclass('progress') is not null then
    update progress k set
      position_s = greatest(k.position_s, f.position_s),
      completed_at = case when k.completed_at is null then f.completed_at when f.completed_at is null then k.completed_at else least(k.completed_at, f.completed_at) end,
      updated_at = greatest(k.updated_at, f.updated_at)
    from progress f
    where k.viewer_id = p_into and f.viewer_id = p_from and f.episode_id = k.episode_id;
  end if;
  -- Story episodes: the one that saw more scenes.
  if to_regclass('story_progress') is not null then
    update story_progress k set scene_id = f.scene_id, history = f.history, updated_at = greatest(k.updated_at, f.updated_at)
    from story_progress f
    where k.viewer_id = p_into and f.viewer_id = p_from and f.episode_id = k.episode_id
      and coalesce(array_length(f.history, 1), 0) > coalesce(array_length(k.history, 1), 0);
  end if;
  -- Story choices and endings: everything either account unlocked.
  if to_regclass('story_state') is not null then
    update story_state k set
      flags = array(select distinct unnest(k.flags || f.flags)),
      endings = array(select distinct unnest(k.endings || f.endings)),
      updated_at = greatest(k.updated_at, f.updated_at)
    from story_state f
    where k.viewer_id = p_into and f.viewer_id = p_from and f.series_id = k.series_id;
  end if;
  -- Rooms: on a round both answered, a right answer beats a wrong one (weekly score).
  update room_answers k set option_id = f.option_id, correct = true
  from room_answers f
  where k.viewer_id = p_into and f.viewer_id = p_from and f.round_id = k.round_id and f.correct is true and k.correct is not true;
  -- AI People: one chat per character; the merged account's messages join the kept chat.
  update ai_chat_messages m set chat_id = k.id
  from ai_chats f join ai_chats k on k.person_id = f.person_id and k.viewer_id = p_into
  where f.viewer_id = p_from and m.chat_id = f.id;
  update ai_chats k set updated_at = greatest(k.updated_at, f.updated_at)
  from ai_chats f where k.viewer_id = p_into and f.viewer_id = p_from and f.person_id = k.person_id;
  delete from ai_chats f using ai_chats k where f.viewer_id = p_from and k.viewer_id = p_into and k.person_id = f.person_id;
  -- Star sign: keep the kept account's, else take the other's. Streak days are combined by the move below
  -- (days either account was active), so the streak is at least the longer of the two.
  update viewers set star_sign = coalesce(star_sign, (select star_sign from viewers where id = p_from)) where id = p_into;

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
