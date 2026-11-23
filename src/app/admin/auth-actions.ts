"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit, createAdminSession, requireSignedIn, signOut } from "@/lib/admin/auth";
import { done, str } from "@/lib/admin/forms";
import { randomToken, safeEqual, sha256Hex } from "@/lib/crypto";
import { emailReady, sendEmail } from "@/lib/email";
import { siteUrl } from "@/lib/site/store";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/security/password";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { currentTenantId, db } from "@/lib/supabase";

// A real hash to compare against when the email is unknown, so timing doesn't reveal which emails exist.
const DUMMY_HASH =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

export async function loginAction(fd: FormData) {
  const email = str(fd, "email", 200).toLowerCase();
  const password = str(fd, "password", 200);
  const ip = clientIp(await headers());

  if (!(await allow(`admin-login:${ip}`, 20, 900)) || !(await allow(`admin-login:${email}`, 5, 900))) {
    done("/admin/login", "Too many attempts. Wait 15 minutes and try again.", "err");
  }

  const tenantId = await currentTenantId();
  const { data: user } = await db()
    .from("admin_users")
    .select("id, password_hash, disabled_at")
    .eq("tenant_id", tenantId)
    .eq("email", email)
    .maybeSingle();

  const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid || user.disabled_at) done("/admin/login", "Wrong email or password.", "err");

  await createAdminSession(user.id);
  redirect("/admin");
}

export async function logoutAction() {
  await signOut();
  redirect("/admin/login");
}

/** First owner account. Works only while there are no admins, and only with ADMIN_SETUP_TOKEN. */
export async function setupAction(fd: FormData) {
  const expected = process.env.ADMIN_SETUP_TOKEN ?? "";
  const token = str(fd, "token", 200);
  if (!expected || expected.length < 16 || !safeEqual(token, expected)) done("/admin/setup", "Setup token is wrong.", "err");

  const tenantId = await currentTenantId();
  const { count } = await db().from("admin_users").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  if ((count ?? 0) > 0) done("/admin/login", "An owner already exists. Sign in instead.", "err");

  const email = str(fd, "email", 200).toLowerCase();
  const password = str(fd, "password", 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) done("/admin/setup", "Enter a valid email.", "err");
  const problem = passwordProblem(password);
  if (problem) done("/admin/setup", problem, "err");

  const { data: user, error } = await db()
    .from("admin_users")
    .insert({ tenant_id: tenantId, email, name: str(fd, "name", 100) || null, role: "owner", password_hash: await hashPassword(password) })
    .select("id")
    .single();
  if (error || !user) done("/admin/setup", "Could not create the account.", "err");
  await createAdminSession(user.id);
  redirect("/admin");
}

export async function changePasswordAction(fd: FormData) {
  const admin = await requireSignedIn();
  const current = str(fd, "current", 200);
  const next = str(fd, "next", 200);
  const { data } = await db().from("admin_users").select("password_hash").eq("id", admin.id).single();
  if (!data || !(await verifyPassword(current, data.password_hash))) done("/admin/account", "Current password is wrong.", "err");
  const problem = passwordProblem(next);
  if (problem) done("/admin/account", problem, "err");
  await db()
    .from("admin_users")
    .update({ password_hash: await hashPassword(next), must_change_password: false })
    .eq("id", admin.id);
  // Sign out every other session for this admin.
  await db().from("admin_sessions").update({ revoked_at: new Date().toISOString() }).eq("admin_id", admin.id).is("revoked_at", null);
  await createAdminSession(admin.id);
  await audit(admin, "password.changed", "admin_user", admin.id);
  done("/admin", "Password changed.");
}

// ---------------------------------------------------------------------------
// Forgot password: an emailed one-time link (30 minutes), or for an owner without email set up, the setup token.

const RESET_MINUTES = 30;
const SAME_ANSWER = "If that email has an admin account, a reset link is on its way. It works for 30 minutes; check spam too.";

/** Email a reset link. The answer never says whether the email has an account. */
export async function requestPasswordResetAction(fd: FormData) {
  const email = str(fd, "email", 200).toLowerCase();
  const ip = clientIp(await headers());
  if (!(await allow(`admin-reset:${ip}`, 10, 3600)) || !(await allow(`admin-reset:${email}`, 3, 3600))) {
    done("/admin/forgot", "Too many requests. Wait an hour and try again.", "err");
  }
  if (!emailReady()) done("/admin/forgot", "Email isn't set up for this admin yet, so no link can be sent. Use one of the other ways below.", "err");

  const tenantId = await currentTenantId();
  const { data: user } = await db().from("admin_users").select("id, email, name, disabled_at").eq("tenant_id", tenantId).eq("email", email).maybeSingle();
  if (user && !user.disabled_at) {
    const token = randomToken(32);
    await db()
      .from("admin_password_resets")
      .insert({ admin_id: user.id, token_hash: sha256Hex(token), expires_at: new Date(Date.now() + RESET_MINUTES * 60_000).toISOString() });
    const link = `${await siteUrl()}/admin/reset?token=${token}`;
    const hi = user.name ? `Hi ${user.name},` : "Hi,";
    await sendEmail(
      user.email,
      "Reset your Watchat admin password",
      `${hi}\n\nSomeone asked to reset the password of your Watchat admin account. Open this link within ${RESET_MINUTES} minutes to choose a new one:\n\n${link}\n\nIf it wasn't you, ignore this email: your password stays the same.`,
      `<p>${hi}</p><p>Someone asked to reset the password of your Watchat admin account. Open this link within ${RESET_MINUTES} minutes to choose a new one:</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#31e5a0;color:#06281c;border-radius:12px;font-weight:700;text-decoration:none">Choose a new password</a></p><p style="color:#666">If it wasn't you, ignore this email: your password stays the same.</p>`,
    );
  }
  done("/admin/forgot", SAME_ANSWER);
}

async function setNewPassword(adminId: string, tenantId: string, password: string, via: string) {
  await db().from("admin_users").update({ password_hash: await hashPassword(password), must_change_password: false }).eq("id", adminId);
  // Every session of this admin ends; older reset links stop working.
  const now = new Date().toISOString();
  await db().from("admin_sessions").update({ revoked_at: now }).eq("admin_id", adminId).is("revoked_at", null);
  await db().from("admin_password_resets").update({ used_at: now }).eq("admin_id", adminId).is("used_at", null);
  const { error } = await db().from("audit_log").insert({ tenant_id: tenantId, admin_id: adminId, action: "password.reset", entity: "admin_user", entity_id: adminId, details: { via } });
  if (error) console.error("[audit] insert failed", error.message);
}

/** Finish a reset from the emailed link. */
export async function resetPasswordAction(fd: FormData) {
  const token = str(fd, "token", 200);
  const back = `/admin/reset?token=${encodeURIComponent(token)}`;
  const password = str(fd, "password", 200);
  if (password !== str(fd, "confirm", 200)) done(back, "The two passwords don't match.", "err");
  const problem = passwordProblem(password);
  if (problem) done(back, problem, "err");
  const { data: row } = await db()
    .from("admin_password_resets")
    .select("id, admin_id, expires_at, used_at, admin_users!inner(tenant_id, disabled_at)")
    .eq("token_hash", sha256Hex(token))
    .maybeSingle();
  const user = (row as unknown as { admin_users?: { tenant_id: string; disabled_at: string | null } } | null)?.admin_users;
  if (!row || row.used_at || new Date(row.expires_at) < new Date() || !user || user.disabled_at) {
    done("/admin/forgot", "That reset link has expired or was already used. Ask for a new one.", "err");
  }
  await setNewPassword(row.admin_id, user.tenant_id, password, "email");
  done("/admin/login", "Password changed. Sign in with the new one.");
}

/** An owner who can't get an email: prove it with ADMIN_SETUP_TOKEN (from Vercel) and set a new password. */
export async function ownerRecoveryAction(fd: FormData) {
  const ip = clientIp(await headers());
  if (!(await allow(`admin-recover:${ip}`, 5, 3600))) done("/admin/forgot", "Too many attempts. Wait an hour and try again.", "err");
  const expected = process.env.ADMIN_SETUP_TOKEN ?? "";
  const token = str(fd, "token", 200);
  const email = str(fd, "email", 200).toLowerCase();
  const password = str(fd, "password", 200);
  if (!expected || expected.length < 16 || !safeEqual(token, expected)) done("/admin/forgot", "Setup token or email is wrong.", "err");
  const tenantId = await currentTenantId();
  const { data: user } = await db().from("admin_users").select("id, role, disabled_at").eq("tenant_id", tenantId).eq("email", email).maybeSingle();
  if (!user || user.role !== "owner" || user.disabled_at) done("/admin/forgot", "Setup token or email is wrong.", "err");
  if (password !== str(fd, "confirm", 200)) done("/admin/forgot", "The two passwords don't match.", "err");
  const problem = passwordProblem(password);
  if (problem) done("/admin/forgot", problem, "err");
  await setNewPassword(user.id, tenantId, password, "setup_token");
  done("/admin/login", "Password changed. Sign in with the new one.");
}
