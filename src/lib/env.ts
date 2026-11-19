// Environment variables, read lazily so `next build` works without secrets present.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

export const env = {
  get appUrl() {
    return required("APP_URL").replace(/\/$/, "");
  },
  get tenantSlug() {
    return process.env.TENANT_SLUG || "watchat";
  },
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
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
  get streamCustomerCode() {
    return process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE || "";
  },
};
