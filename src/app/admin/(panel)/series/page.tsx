import Link from "next/link";
import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/supabase";
import { createSeriesAction } from "../../content-actions";

export const dynamic = "force-dynamic";

export default async function SeriesList({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("content");
  const sp = await searchParams;
  const { data: series } = await db()
    .from("series")
    .select("id, code, title_ar, title_en, status, created_at, episodes(count)")
    .eq("tenant_id", admin.tenantId)
    .order("created_at", { ascending: false });

  return (
    <>
      <h1>Series & episodes</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <table className="card">
        <thead>
          <tr>
            <th>Code</th>
            <th>Title</th>
            <th>Episodes</th>
            <th>Status</th>
            <th>WhatsApp link</th>
          </tr>
        </thead>
        <tbody>
          {(series ?? []).map((s) => (
            <tr key={s.id}>
              <td>
                <Link href={`/admin/series/${s.id}`}>{s.code}</Link>
              </td>
              <td>
                {s.title_en}
                <div className="muted" dir="rtl">
                  {s.title_ar}
                </div>
              </td>
              <td>{(s.episodes as unknown as { count: number }[])?.[0]?.count ?? 0}</td>
              <td>
                <span className={`badge ${s.status}`}>{s.status}</span>
              </td>
              <td className="muted">wa.me/&lt;number&gt;?text={s.code}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <form action={createSeriesAction} className="card">
        <h2 style={{ marginTop: 0 }}>New series</h2>
        <div className="grid3">
          <label>
            Code (sent in WhatsApp)
            <input name="code" placeholder="DESERT02" required pattern="[A-Za-z]{3,}[0-9]{1,3}" />
          </label>
          <label>
            Title (Arabic)
            <input name="title_ar" dir="rtl" required />
          </label>
          <label>
            Title (English)
            <input name="title_en" required />
          </label>
          <label>
            Number of episodes
            <input name="episodes" type="number" min={1} max={100} defaultValue={30} />
          </label>
        </div>
        <p>
          <button type="submit">Create series</button>
        </p>
      </form>
    </>
  );
}
