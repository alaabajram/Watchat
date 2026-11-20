// Admin authentication: email + password (scrypt), HttpOnly SameSite=Strict session cookie (8 h),
// role checks on every page and action, and an audit log of every change.

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { randomToken, sha256Hex } from "../crypto";
import { clientIp } from "../security/rate-limit";
import { currentTenantId, db } from "../supabase";

export const ADMIN_COOKIE = "wc_admin";
export const ADMIN_SESSION_HOURS = 8;

export type AdminRole = "owner" | "content" | "marketing" | "support" | "finance";

export type Admin = {
  id: string;
  tenantId: string;
  email: string;
  name: string | null;
  role: AdminRole;
  mustChangePassword: boolean;
};

/** Which roles may use each area of the admin. Owners can do everything. */
export const PERMISSIONS = {
  dashboard: ["owner", "content", "marketing", "support", "finance"],
  content: ["owner", "content"],
  bot: ["owner", "content", "marketing"],
  messaging: ["owner", "marketing"],
  viewers: ["owner", "support", "finance"],
  grantCoins: ["owner", "support"],
  orders: ["owner", "finance", "support"],
  pricing: ["owner", "finance"],
  team: ["owner"],
  aiAccount: ["owner"],
  audit: ["owner", "finance"],
} as const satisfies Record<string, readonly AdminRole[]>;

export type Area = keyof typeof PERMISSIONS;

export function can(admin: Admin, area: Area): boolean {
  return (PERMISSIONS[area] as readonly AdminRole[]).includes(admin.role);
}

export async function createAdminSession(adminId: string): Promise<void> {
  const token = randomToken(32);
  const h = await headers();
  const expires = new Date(Date.now() + ADMIN_SESSION_HOURS * 3600 * 1000);
  const { error } = await db()
    .from("admin_sessions")
    .insert({
      admin_id: adminId,
      token_hash: sha256Hex(token),
      ip: clientIp(h),
      user_agent: h.get("user-agent"),
      expires_at: expires.toISOString(),
    });
  if (error) throw new Error(`admin session failed: ${error.message}`);
  await db().from("admin_users").update({ last_login_at: new Date().toISOString() }).eq("id", adminId);
  (await cookies()).set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires,
  });
}

export async function getAdmin(): Promise<Admin | null> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  const { data } = await db()
    .from("admin_sessions")
    .select("expires_at, revoked_at, admin_users!inner(id, tenant_id, email, name, role, must_change_password, disabled_at)")
    .eq("token_hash", sha256Hex(token))
    .maybeSingle();
  if (!data || data.revoked_at || new Date(data.expires_at) < new Date()) return null;
  const u = (data as unknown as {
    admin_users: {
      id: string;
      tenant_id: string;
      email: string;
      name: string | null;
      role: AdminRole;
      must_change_password: boolean;
      disabled_at: string | null;
    };
  }).admin_users;
  if (u.disabled_at) return null;
  if (u.tenant_id !== (await currentTenantId())) return null;
  return { id: u.id, tenantId: u.tenant_id, email: u.email, name: u.name, role: u.role, mustChangePassword: u.must_change_password };
}

/** Use at the top of every admin page and server action. Redirects to login, or 403s on missing role. */
export async function requireAdmin(area: Area = "dashboard"): Promise<Admin> {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  if (admin.mustChangePassword) redirect("/admin/account?first=1");
  if (!can(admin, area)) redirect("/admin?denied=1");
  return admin;
}

/** Like requireAdmin but allows a pending password change (for the account page itself). */
export async function requireSignedIn(): Promise<Admin> {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (token) {
    await db().from("admin_sessions").update({ revoked_at: new Date().toISOString() }).eq("token_hash", sha256Hex(token));
  }
  jar.delete(ADMIN_COOKIE);
}

export async function audit(
  admin: Admin,
  action: string,
  entity?: string,
  entityId?: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db()
    .from("audit_log")
    .insert({ tenant_id: admin.tenantId, admin_id: admin.id, action, entity, entity_id: entityId ?? null, details });
  if (error) console.error("[audit] insert failed", error.message);
}
