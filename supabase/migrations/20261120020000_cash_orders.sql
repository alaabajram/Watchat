-- Manual cash / bank-transfer orders while online payments are on hold.
-- The viewer requests a pack, gets a short reference, and the team marks the order paid in the admin.

alter table orders drop constraint if exists orders_gateway_check;
alter table orders add constraint orders_gateway_check check (gateway in ('tap', 'dcb', 'cash'));

alter table orders add column payment_ref text;
create unique index orders_payment_ref_idx on orders (payment_ref) where payment_ref is not null;

alter table orders add column decided_by uuid references admin_users(id) on delete set null;
alter table orders add column decided_at timestamptz;
alter table orders add column note text;

create index orders_pending_idx on orders (status, gateway, created_at desc);
