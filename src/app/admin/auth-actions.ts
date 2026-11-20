"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit, createAdminSession, requireSignedIn, signOut } from "@/lib/admin/auth";
import { done, str } from "@/lib/admin/forms";
import { safeEqual } from "@/lib/crypto";
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
