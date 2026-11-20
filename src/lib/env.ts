// Environment variables, read lazily so `next build` works without secrets present.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

/** First non-empty variable among `names`; throws naming them all if none is set. */
function requiredAny(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Missing environment variable: set one of ${names.join(", ")} (see .env.example)`);
}

export const env = {
  get appUrl() {
    return required("APP_URL").replace(/\/$/, "");
  },
  get tenantSlug() {
    return process.env.TENANT_SLUG || "watchat";
  },
  // The Vercel ↔ Supabase integration sets NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY
  // (new-style sb_secret_ key); manual setups often use SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
  get supabaseUrl() {
    return requiredAny("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseServiceRoleKey() {
    return requiredAny("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  },
  get waPhoneNumberId() {
    return required("WHATSAPP_PHONE_NUMBER_ID");
  },
  get waAccessToken() {
    return required("WHATSAPP_ACCESS_TOKEN");
  },
  get waAppSecret() {
    return required("WHATSAPP_APP_SECRET");
  },
  get waVerifyToken() {
    return required("WHATSAPP_VERIFY_TOKEN");
  },
  get waGraphVersion() {
    return process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
  },
  get waDisplayNumber() {
    return (process.env.WHATSAPP_DISPLAY_NUMBER || "").replace(/\D/g, "");
  },
  get phoneHashSecret() {
    return required("PHONE_HASH_SECRET");
  },
  /** Encrypts per-label secrets such as AI API keys (32+ random characters). */
  get settingsEncryptionKey() {
    return required("SETTINGS_ENCRYPTION_KEY");
  },
  get streamCustomerCode() {
    return process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE || "";
  },
};
