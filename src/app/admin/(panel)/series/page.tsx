import Link from "next/link";
import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { hasContent, readiness } from "@/lib/admin/readiness";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function SeriesList({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("content");
  const sp = await searchParams;
  const { data: series } = await db()
    .from("series")
    .select(
      "id, code, title_ar, title_en, status, created_at, poster_url, synopsis_ar, tagline_ar, genres, banner_wa_url, trailer_video_url, wa_episode_count, free_web_until_ep, coins_per_episode, format, episodes(number, status, stream_uid, wa_video_url_ar, story_ready), licences(count), content_reviews(decision, created_at)",
    )
    .eq("tenant_id", admin.tenantId)
    .order("created_at", { ascending: false });

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Series</h1>
        <Link href="/admin/series/new" className="abtn">
          ＋ Launch a new series
        </Link>
      </div>
      <p className="muted">Every series you sell. Open one to edit it, or follow its checklist to get it live.</p>
      <Flash ok={sp.ok} err={sp.err} />
      <table className="card">
        <thead>
          <tr>
            <th>Series</th>
            <th>Chat code</th>
            <th>Episodes</th>
            <th>Status</th>
            <th>Next step</th>
          </tr>
        </thead>
        <tbody>
          {(series ?? []).map((s) => {
            const eps = (s.episodes ?? []) as { number: number; status: string; stream_uid: string | null; wa_video_url_ar: string | null; story_ready: boolean | null }[];
            const reviews = ((s.content_reviews ?? []) as { decision: string; created_at: string }[]).sort((a, b) => b.created_at.localeCompare(a.created_at));
            const r = readiness(s, eps, (s.licences as unknown as { count: number }[])?.[0]?.count ?? 0, reviews[0]?.decision ?? null);
            const firstGap = r.items.find((i) => i.required && !i.done);
            return (
              <tr key={s.id}>
                <td>
                  <Link href={`/admin/series/${s.id}`} style={{ display: "flex", gap: 10, alignItems: "center", textDecoration: "none", color: "inherit" }}>
                    {s.poster_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.poster_url} alt="" width={36} height={54} style={{ objectFit: "cover", borderRadius: 6 }} />
                    ) : (
                      <span style={{ width: 36, height: 54, borderRadius: 6, background: "#eee", display: "inline-block" }} />
                    )}
                    <span>
                      <strong>{s.title_en}</strong>
                      <div className="muted" dir="rtl">
                        {s.title_ar}
                      </div>
                    </span>
                  </Link>
                </td>
                <td>
                  <code>{s.code}</code>
                </td>
                <td>
                  {eps.filter(hasContent).length}/{eps.length}
                  <div className="muted" style={{ fontSize: 12 }}>{s.format === "story" ? "story published" : "with video"}</div>
                </td>
                <td>
                  <span className={`badge ${s.status}`}>{s.status === "live" ? "live" : s.status}</span>
                </td>
                <td>
                  {s.status === "live" ? (
                    <span className="muted">Live ✓</span>
                  ) : r.ready ? (
                    <Link href={`/admin/series/${s.id}/launch?step=5`}>Ready · publish →</Link>
                  ) : (
                    <Link href={`/admin/series/${s.id}/launch?step=${firstGap?.step ?? 2}`}>
                      {firstGap?.label}: {firstGap?.detail} →
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
          {(series ?? []).length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No series yet. <Link href="/admin/series/new">Launch your first one →</Link>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
