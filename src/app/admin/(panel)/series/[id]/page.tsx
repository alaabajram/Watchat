// Series editor: details, scenario (chat flow) switches, pricing, media, episodes, licence, review & publish.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/admin/Flash";
import { MediaUpload } from "@/components/admin/MediaUpload";
import { requireAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/supabase";
import {
  addEpisodesAction,
  addLicenceAction,
  reviewSeriesAction,
  setSeriesStatusAction,
  updateEpisodeAction,
  updateSeriesAction,
} from "../../../content-actions";

export const dynamic = "force-dynamic";

export default async function SeriesEdit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("content");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const [{ data: s }, { data: episodes }, { data: licences }, { data: reviews }] = await Promise.all([
    db().from("series").select("*").eq("id", id).eq("tenant_id", admin.tenantId).maybeSingle(),
    db().from("episodes").select("*").eq("series_id", id).order("number"),
    db().from("licences").select("*").eq("series_id", id).order("created_at", { ascending: false }),
    db().from("content_reviews").select("*").eq("series_id", id).order("created_at", { ascending: false }).limit(5),
  ]);
  if (!s) notFound();
  const eps = episodes ?? [];
  const lastReview = reviews?.[0];

  return (
    <>
      <p>
        <Link href="/admin/series">← All series</Link> · <Link href={`/admin/flows/${s.id}`}>Open this series&apos; chat flow builder →</Link>
      </p>
      <h1>
        {s.code} · {s.title_en} <span className={`badge ${s.status}`}>{s.status}</span>
      </h1>
      <Flash ok={sp.ok} err={sp.err} />

      {/* Publish workflow */}
      <div className="card row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>Publishing</strong>
          <div className="muted">
            Licence: {licences?.length ? "✓ on record" : "✗ missing"} · Review:{" "}
            {lastReview ? `${lastReview.decision} by ${lastReview.reviewer}` : "not reviewed"}
          </div>
        </div>
        <div className="row">
          <form action={reviewSeriesAction} className="row">
            <input type="hidden" name="id" value={s.id} />
            <input name="notes" placeholder="Review notes (optional)" />
            <button name="decision" value="approved" type="submit">
              Approve as family-safe
            </button>
            <button name="decision" value="rejected" type="submit" className="secondary">
              Reject
            </button>
          </form>
          <form action={setSeriesStatusAction} className="row">
            <input type="hidden" name="id" value={s.id} />
            {s.status !== "live" && (
              <button name="status" value="live" type="submit">
                Publish
              </button>
            )}
            {s.status === "live" && (
              <button name="status" value="draft" type="submit" className="secondary">
                Unpublish
              </button>
            )}
            {s.status !== "archived" && (
              <button name="status" value="archived" type="submit" className="secondary">
                Archive
              </button>
            )}
          </form>
        </div>
      </div>

      {/* Details, scenario and pricing */}
      <form action={updateSeriesAction} className="card">
        <input type="hidden" name="id" value={s.id} />
        <h2 style={{ marginTop: 0 }}>Details</h2>
        <div className="grid2">
          <label>
            Title (Arabic)
            <input name="title_ar" dir="rtl" defaultValue={s.title_ar} required />
          </label>
          <label>
            Title (English)
            <input name="title_en" defaultValue={s.title_en} required />
          </label>
          <label>
            Synopsis (Arabic)
            <textarea name="synopsis_ar" dir="rtl" defaultValue={s.synopsis_ar ?? ""} />
          </label>
          <label>
            Synopsis (English)
            <textarea name="synopsis_en" defaultValue={s.synopsis_en ?? ""} />
          </label>
          <label>
            Poster URL
            <input name="poster_url" defaultValue={s.poster_url ?? ""} />
          </label>
          <label>
            Trailer for WhatsApp (MP4 under 16 MB)
            <input name="trailer_video_url" defaultValue={s.trailer_video_url ?? ""} />
          </label>
          <label>
            Dialect
            <select name="dialect" defaultValue={s.dialect}>
              <option value="gulf">Gulf</option>
              <option value="egyptian">Egyptian</option>
              <option value="levantine">Levantine</option>
              <option value="msa">Modern Standard Arabic</option>
            </select>
          </label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <MediaUpload kind="poster" seriesCode={s.code} target="series" id={s.id} field="poster_url" label="Upload poster" />
          <MediaUpload kind="clip" seriesCode={s.code} target="series" id={s.id} field="trailer_video_url" label="Upload trailer clip" />
        </div>

        <h2>Chat scenario</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          What happens after a viewer sends <code>{s.code}</code> in WhatsApp.
        </p>
        <div className="grid3">
          <label className="inline">
            <input type="checkbox" name="ask_language" defaultChecked={s.ask_language} /> Ask Arabic / English subtitles first
          </label>
          <label className="inline">
            <input type="checkbox" name="send_trailer" defaultChecked={s.send_trailer} /> Send the trailer before episode 1
          </label>
          <label className="inline">
            <input type="checkbox" name="ask_opt_in" defaultChecked={s.ask_opt_in} /> Ask for new-episode alerts after the link
          </label>
          <label>
            Episodes sent inside WhatsApp (0–5)
            <input name="wa_episode_count" type="number" min={0} max={5} defaultValue={s.wa_episode_count} />
          </label>
        </div>

        <h2>Paywall & prices</h2>
        <div className="grid3">
          <label>
            Free on the web up to episode
            <input name="free_web_until_ep" type="number" min={0} defaultValue={s.free_web_until_ep} />
          </label>
          <label>
            Paywall at episode
            <input name="paywall_ep" type="number" min={1} defaultValue={s.paywall_ep} />
          </label>
          <label>
            Coins per episode
            <input name="coins_per_episode" type="number" min={1} defaultValue={s.coins_per_episode} />
          </label>
          <label>
            Season pass (AED, VAT incl.)
            <input name="season_pass_price_aed" type="number" step="0.01" defaultValue={s.season_pass_price_aed ?? ""} />
          </label>
          <label>
            Season pass (SAR, VAT incl.)
            <input name="season_pass_price_sar" type="number" step="0.01" defaultValue={s.season_pass_price_sar ?? ""} />
          </label>
        </div>
        <p>
          <button type="submit">Save series</button>
        </p>
      </form>

      {/* Episodes */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Episodes ({eps.length})</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Episodes 1–{s.wa_episode_count} need WhatsApp clips (Arabic, and English with burned-in subtitles). Every episode needs the full
          video on Cloudflare Stream for the web.
        </p>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Titles</th>
              <th>Web video (Stream)</th>
              <th>WhatsApp clips</th>
              <th>Coins</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {eps.map((e) => (
              <tr key={e.id} id={`ep-${e.id}`}>
                <td>
                  <strong>{e.number}</strong>
                  <div>
                    <span className={`badge ${e.status}`}>{e.status}</span>
                  </div>
                </td>
                <td colSpan={5}>
                  <form action={updateEpisodeAction} className="grid3">
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="series_id" value={s.id} />
                    <input name="title_ar" dir="rtl" defaultValue={e.title_ar ?? ""} placeholder="العنوان" />
                    <input name="title_en" defaultValue={e.title_en ?? ""} placeholder="Title" />
                    <input name="stream_uid" defaultValue={e.stream_uid ?? ""} placeholder="Stream video id" />
                    {e.number <= s.wa_episode_count && (
                      <>
                        <input name="wa_video_url_ar" defaultValue={e.wa_video_url_ar ?? ""} placeholder="WhatsApp clip URL (Arabic)" />
                        <input name="wa_video_url_en" defaultValue={e.wa_video_url_en ?? ""} placeholder="WhatsApp clip URL (English subs)" />
                      </>
                    )}
                    <input name="coin_price_override" type="number" min={1} defaultValue={e.coin_price_override ?? ""} placeholder={`Coins (default ${s.coins_per_episode})`} />
                    <div className="row">
                      <button type="submit" className="secondary">
                        Save
                      </button>
                      <MediaUpload kind="stream" seriesCode={s.code} target="episode" id={e.id} field="stream_uid" label="Web video" />
                      {e.number <= s.wa_episode_count && (
                        <>
                          <MediaUpload kind="clip" seriesCode={s.code} target="episode" id={e.id} field="wa_video_url_ar" label="Clip AR" />
                          <MediaUpload kind="clip" seriesCode={s.code} target="episode" id={e.id} field="wa_video_url_en" label="Clip EN" />
                        </>
                      )}
                    </div>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={addEpisodesAction} className="row" style={{ marginTop: 12 }}>
          <input type="hidden" name="series_id" value={s.id} />
          <input name="count" type="number" min={1} max={50} defaultValue={1} style={{ width: 80 }} />
          <button type="submit" className="secondary">
            Add episodes
          </button>
        </form>
      </div>

      {/* Licences */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Licence</h2>
        {(licences ?? []).length > 0 && (
          <table style={{ marginBottom: 12 }}>
            <thead>
              <tr>
                <th>Licensor</th>
                <th>Territory</th>
                <th>Dates</th>
                <th>Revenue share</th>
                <th>Document</th>
              </tr>
            </thead>
            <tbody>
              {(licences ?? []).map((l) => (
                <tr key={l.id}>
                  <td>{l.licensor}</td>
                  <td>{l.territory}</td>
                  <td>
                    {l.starts_on} → {l.ends_on ?? "open"}
                  </td>
                  <td>{l.revenue_share_pct ?? "—"}%</td>
                  <td>{l.document_url ? <a href={l.document_url}>Open</a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form action={addLicenceAction} className="grid3">
          <input type="hidden" name="series_id" value={s.id} />
          <label>
            Licensor
            <input name="licensor" required />
          </label>
          <label>
            Territory
            <input name="territory" placeholder="UAE, KSA" required />
          </label>
          <label>
            Revenue share %
            <input name="revenue_share_pct" type="number" step="0.01" />
          </label>
          <label>
            Starts
            <input name="starts_on" type="date" required />
          </label>
          <label>
            Ends
            <input name="ends_on" type="date" />
          </label>
          <label>
            Contract link
            <input name="document_url" />
          </label>
          <div>
            <button type="submit" className="secondary">
              Add licence
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
