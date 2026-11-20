import Link from "next/link";
import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/supabase";
import { findViewerAction } from "../../people-actions";

export const dynamic = "force-dynamic";

export default async function ViewersPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("viewers");
  const sp = await searchParams;
  const { data: recent } = await db()
    .from("viewers")
    .select("id, phone_e164, country, language, last_seen_at")
    .eq("tenant_id", admin.tenantId)
    .neq("phone_e164", "deleted")
    .order("last_seen_at", { ascending: false })
    .limit(20);
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" });

  return (
    <>
      <h1>Viewers</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <form action={findViewerAction} className="card row">
        <label>
          WhatsApp number
          <input name="phone" placeholder="+971 50 123 4567" required />
        </label>
        <button type="submit" style={{ alignSelf: "end" }}>
          Find viewer
        </button>
      </form>
      <h2>Recently active</h2>
      <table className="card">
        <thead>
          <tr>
            <th>Number</th>
            <th>Country</th>
            <th>Language</th>
            <th>Last seen (GST)</th>
          </tr>
        </thead>
        <tbody>
          {(recent ?? []).map((v) => (
            <tr key={v.id}>
              <td>
                <Link href={`/admin/viewers/${v.id}`}>{mask(v.phone_e164)}</Link>
              </td>
              <td>{v.country ?? "—"}</td>
              <td>{v.language === "ar_en_subs" ? "English subs" : v.language === "ar" ? "Arabic" : "—"}</td>
              <td>{fmt.format(new Date(v.last_seen_at))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function mask(phone: string): string {
  return phone.length > 6 ? `${phone.slice(0, 6)} ••• ${phone.slice(-2)}` : phone;
}
