-- The one-time "pin this message · your account is always at watchat.pro/me" tip in the first link.
alter table viewers add column if not exists pin_hint_at timestamptz;
