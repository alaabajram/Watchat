"use server";

import { audit, requireAdmin } from "@/lib/admin/auth";
import { done, opt, str, uuid } from "@/lib/admin/forms";
import { refundStarsOrder } from "@/lib/telegram/payments";
import { approveCashOrder, cancelCashOrder } from "@/lib/wallet";

export async function approveOrderAction(fd: FormData) {
  const admin = await requireAdmin("orders");
  const id = uuid(fd, "id");
  const back = str(fd, "back", 200).startsWith("/admin/") ? str(fd, "back", 200) : "/admin/orders";
  if (!id) done(back, "Bad request.", "err");
  let result: "ok" | "already";
  try {
    result = await approveCashOrder(id, admin.id, opt(fd, "note", 300));
  } catch (e) {
    done(back, e instanceof Error ? e.message : "Could not approve.", "err");
  }
  await audit(admin, "order.cash_approved", "order", id, { note: opt(fd, "note", 300) });
  done(back, result === "ok" ? "Marked as paid. The Ping / pass is now in the viewer's wallet." : "This order was already paid.");
}

export async function cancelOrderAction(fd: FormData) {
  const admin = await requireAdmin("orders");
  const id = uuid(fd, "id");
  const back = str(fd, "back", 200).startsWith("/admin/") ? str(fd, "back", 200) : "/admin/orders";
  if (!id) done(back, "Bad request.", "err");
  await cancelCashOrder(id, admin.id, opt(fd, "note", 300));
  await audit(admin, "order.cash_cancelled", "order", id, { note: opt(fd, "note", 300) });
  done(back, "Order cancelled. Nothing was added to the wallet.");
}

/** Telegram Stars order: Telegram gives the Stars back, and the Ping / pass it gave is taken back. */
export async function refundStarsAction(fd: FormData) {
  const admin = await requireAdmin("orders");
  const id = uuid(fd, "id");
  if (!id) done("/admin/orders", "Bad request.", "err");
  const r = await refundStarsOrder(id);
  await audit(admin, "order.stars_refunded", "order", id, { ok: r.ok, error: r.error ?? null });
  done("/admin/orders", r.ok ? "Refunded: the Stars went back to the viewer and the purchase was taken back." : `Refund failed: ${r.error}`, r.ok ? "ok" : "err");
}
