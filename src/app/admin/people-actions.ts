"use server";

import { marketFromPhone } from "@/lib/spend/meter";
import { randomBytes } from "node:crypto";
import { audit, requireAdmin } from "@/lib/admin/auth";
import { bool, done, int, num, opt, str, uuid } from "@/lib/admin/forms";
import { phoneHmac } from "@/lib/bot/deps-supabase";
import { mintLink } from "@/lib/links";
import { hashPassword } from "@/lib/security/password";
import { db } from "@/lib/supabase";
import { sendWhatsApp } from "@/lib/whatsapp/client";

// ---------------------------------------------------------------------------
// Viewers (support)
// ---------------------------------------------------------------------------

export async function findViewerAction(fd: FormData) {
  const admin = await requireAdmin("viewers");
  const digits = str(fd, "phone", 30).replace(/\D/g, "").replace(/^00/, "");
  if (digits.length < 8) done("/admin/viewers", "Enter the full number with country code, e.g. +971 50 123 4567.", "err");
  const { data } = await db()
    .from("viewers")
    .select("id")
    .eq("tenant_id", admin.tenantId)
    .eq("phone_hmac", phoneHmac(digits))
    .maybeSingle();
  await audit(admin, "viewer.lookup", "viewer", data?.id ?? null);
  if (!data) done("/admin/viewers", "No viewer with that number.", "err");
  done(`/admin/viewers/${data.id}`, "Found.");
}

export async function grantCoinsAction(fd: FormData) {
  const admin = await requireAdmin("grantCoins");
  const id = uuid(fd, "id");
  const coins = int(fd, "coins", 0);
  const note = str(fd, "note", 200);
  if (!id) done("/admin/viewers", "Bad request.", "err");
  if (coins < 1 || coins > 10000) done(`/admin/viewers/${id}`, "Grant 1–10,000 Ping.", "err");
  if (!note) done(`/admin/viewers/${id}`, "Add a reason (e.g. support ticket number).", "err");
  const { data, error } = await db().rpc("grant_coins", { p_viewer: id, p_coins: coins, p_admin: admin.id, p_note: note });
  if (error) done(`/admin/viewers/${id}`, `Grant failed: ${error.message}`, "err");
  await audit(admin, "coins.granted", "viewer", id, { coins, note });
  done(`/admin/viewers/${id}`, `Granted ${coins} Ping. New balance: ${data}.`);
}

export async function signOutViewerAction(fd: FormData) {
  const admin = await requireAdmin("viewers");
  const id = uuid(fd, "id");
  if (!id) done("/admin/viewers", "Bad request.", "err");
  await db().from("sessions").update({ revoked_at: new Date().toISOString() }).eq("viewer_id", id).is("revoked_at", null);
  await audit(admin, "viewer.signed_out", "viewer", id);
  done(`/admin/viewers/${id}`, "Signed out of all devices. They can use a fresh WhatsApp link to come back.");
}

/** Sends the player link in WhatsApp. Works only within 24 h of the viewer's last message (Meta rule). */
export async function resendLinkAction(fd: FormData) {
  const admin = await requireAdmin("viewers");
  const id = uuid(fd, "id");
  if (!id) done("/admin/viewers", "Bad request.", "err");
  const { data: v } = await db().from("viewers").select("phone_e164").eq("id", id).single();
  const { data: state } = await db().from("chat_state").select("series_id").eq("viewer_id", id).maybeSingle();
  if (!v || !state?.series_id) done(`/admin/viewers/${id}`, "This viewer hasn't started a series yet.", "err");
  const { data: series } = await db().from("series").select("wa_episode_count").eq("id", state.series_id).single();
  const url = await mintLink({ viewerId: id, seriesId: state.series_id, episodeNumber: (series?.wa_episode_count ?? 3) + 1, purpose: "menu" });
  const result = await sendWhatsApp(v.phone_e164.replace(/^\+/, ""), {
    kind: "cta_url",
    body: "رابطك الشخصي لواتشات · Your Watchat player link",
    buttonText: "افتح المشغّل",
    url,
  });
  await db()
    .from("wa_messages")
    .insert({
      viewer_id: id,
      direction: "out",
      wa_message_id: result.ok ? result.waMessageId : null,
      kind: "cta_url",
      category: "service",
      source: "admin",
      market: marketFromPhone(v.phone_e164),
      status: result.ok ? "sent" : "failed",
      error: result.ok ? null : result.error,
    });
  await audit(admin, "viewer.link_resent", "viewer", id, { ok: result.ok });
  if (!result.ok) {
    done(`/admin/viewers/${id}`, `WhatsApp refused (${result.error}). If it's been over 24 h since their last message, ask them to send LINK.`, "err");
  }
  done(`/admin/viewers/${id}`, "Link sent in WhatsApp.");
}

/** Data deletion request: removes personal data, keeps paid-order records for tax law. */
export async function anonymiseViewerAction(fd: FormData) {
  const admin = await requireAdmin("viewers");
  const id = uuid(fd, "id");
  if (!id || str(fd, "confirm", 10) !== "DELETE") done(`/admin/viewers/${id ?? ""}`, 'Type DELETE to confirm.', "err");
  await db().from("sessions").update({ revoked_at: new Date().toISOString() }).eq("viewer_id", id).is("revoked_at", null);
  await Promise.all([
    db().from("chat_state").delete().eq("viewer_id", id),
    db().from("link_tokens").delete().eq("viewer_id", id),
    db().from("progress").delete().eq("viewer_id", id),
    db().from("spend_confirmations").delete().eq("viewer_id", id),
  ]);
  await db().from("opt_ins").insert({ viewer_id: id, status: "out", source: "data_deletion" });
  await db()
    .from("viewers")
    .update({ phone_e164: "deleted", phone_hmac: `deleted:${id}`, wa_profile_name: null, country: null })
    .eq("id", id);
  await audit(admin, "viewer.anonymised", "viewer", id);
  done(`/admin/viewers/${id}`, "Personal data deleted. Paid orders are kept without the phone number.");
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

const ROLES = ["owner", "content", "marketing", "support", "finance"];

export async function inviteAdminAction(fd: FormData) {
  const admin = await requireAdmin("team");
  const email = str(fd, "email", 200).toLowerCase();
  const role = str(fd, "role", 20);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !ROLES.includes(role)) done("/admin/team", "Enter an email and pick a role.", "err");
  // A one-time temporary password, shown once; the user must change it at first sign-in.
  const temp = randomBytes(12).toString("base64url");
  const { error } = await db()
    .from("admin_users")
    .insert({ tenant_id: admin.tenantId, email, name: opt(fd, "name", 100), role, password_hash: await hashPassword(temp), must_change_password: true });
  if (error) done("/admin/team", error.code === "23505" ? "That email already has an account." : `Failed: ${error.message}`, "err");
  await audit(admin, "admin.invited", "admin_user", email, { role });
  done("/admin/team", `Account created for ${email}. Temporary password (shown once, send it privately): ${temp}`);
}

export async function updateAdminAction(fd: FormData) {
  const admin = await requireAdmin("team");
  const id = uuid(fd, "id");
  if (!id) done("/admin/team", "Bad request.", "err");
  if (id === admin.id) done("/admin/team", "You can't change your own role or disable yourself.", "err");
  const role = str(fd, "role", 20);
  const disabled = bool(fd, "disabled");
  if (!ROLES.includes(role)) done("/admin/team", "Bad role.", "err");
  await db()
    .from("admin_users")
    .update({ role, disabled_at: disabled ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("tenant_id", admin.tenantId);
  if (disabled) await db().from("admin_sessions").update({ revoked_at: new Date().toISOString() }).eq("admin_id", id).is("revoked_at", null);
  await audit(admin, "admin.updated", "admin_user", id, { role, disabled });
  done("/admin/team", "Team member updated.");
}

/** An owner gives a team member a new one-time temporary password (shown once); their sessions end. */
export async function resetAdminPasswordAction(fd: FormData) {
  const admin = await requireAdmin("team");
  const id = uuid(fd, "id");
  if (!id || id === admin.id) done("/admin/team", "Change your own password from Your account.", "err");
  const { data: user } = await db().from("admin_users").select("email").eq("id", id).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!user) done("/admin/team", "Not found.", "err");
  const temp = randomBytes(12).toString("base64url");
  await db().from("admin_users").update({ password_hash: await hashPassword(temp), must_change_password: true }).eq("id", id).eq("tenant_id", admin.tenantId);
  await db().from("admin_sessions").update({ revoked_at: new Date().toISOString() }).eq("admin_id", id).is("revoked_at", null);
  await audit(admin, "admin.password_reset", "admin_user", id);
  done("/admin/team", `New temporary password for ${user.email} (shown once, send it privately): ${temp}. They choose their own at next sign-in.`);
}
