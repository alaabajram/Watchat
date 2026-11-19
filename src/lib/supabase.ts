import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | null = null;

/**
 * Server-only Supabase client using the service role key.
 * Never import this from a client component: RLS has no policies, so this key can read everything.
 */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

let tenantIdCache: string | null = null;

export async function currentTenantId(): Promise<string> {
  if (tenantIdCache) return tenantIdCache;
  const { data, error } = await db().from("tenants").select("id").eq("slug", env.tenantSlug).single();
  if (error || !data) throw new Error(`Tenant "${env.tenantSlug}" not found. Did you run supabase/seed.sql?`);
  tenantIdCache = data.id as string;
  return tenantIdCache;
}
