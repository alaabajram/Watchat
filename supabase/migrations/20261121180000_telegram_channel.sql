-- Telegram as a second chat channel. A Telegram viewer is a normal viewer whose address is "tg:<chat id>"
-- (phone_e164 "+tg:<id>", phone_hmac of "tg:<id>"), so all bot, flow and messaging code works unchanged.
-- Telegram messages are free: mark them so the spend meter never counts them.

create or replace function wa_messages_telegram_free()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.viewer_id is not null and exists (select 1 from viewers where id = new.viewer_id and phone_e164 like '+tg:%') then
    new.billable := false;
    new.pricing_type := 'free_telegram';
  elsif new.wa_message_id like 'tg:%' then
    new.billable := false;
    new.pricing_type := 'free_telegram';
  end if;
  return new;
end;
$$;

drop trigger if exists wa_messages_telegram_free on wa_messages;
create trigger wa_messages_telegram_free before insert on wa_messages
for each row execute function wa_messages_telegram_free();

-- Find Telegram viewers quickly (admin filters, channel counts).
create index if not exists viewers_telegram on viewers (tenant_id) where phone_e164 like '+tg:%';
