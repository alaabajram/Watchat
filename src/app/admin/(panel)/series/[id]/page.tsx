// Series editor: details, chat episodes, pricing, media, episodes, licence, review & publish. The chat itself is in the Flow builder.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash } from "@/components/admin/Flash";
import { ArtworkSlots } from "@/components/admin/ArtworkSlots";
import { BulkEpisodes } from "@/components/admin/BulkEpisodes";
import { MediaUpload } from "@/components/admin/MediaUpload";
import { WhatsAppVersion } from "@/components/admin/WhatsAppVersion";
import { SeriesMediaLibrary } from "@/components/flow/SeriesMediaLibrary";
import { AGE_RATINGS, GENRES, GENRE_LABELS, type CastMember } from "@/lib/content-meta";
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

  const [{ data: s }, { data: episodes }, { data: licences }, { data: reviews }, { data: assets }] = await Promise.all([
    db().from("series").select("*").eq("id", id).eq("tenant_id", admin.tenantId).maybeSingle(),
    db().from("episodes").select("*").eq("series_id", id).order("number"),
    db().from("licences").select("*").eq("series_id", id).order("created_at", { ascending: false }),
    db().from("content_reviews").select("*").eq("series_id", id).order("created_at", { ascending: false }).limit(5),
    db().from("media_assets").select("id, kind, name, url, size_bytes, created_at").eq("tenant_id", admin.tenantId).eq("series_id", id).order("created_at", { ascending: false }),
  ]);
  if (!s) notFound();
  const eps = episodes ?? [];
  const lastReview = reviews?.[0];
  const cast = (s?.cast_members ?? []) as CastMember[];
  const castRows = Array.from({ length: Math.min(12, Math.max(3, cast.length + 2)) }, (_, i) => cast[i] ?? { name_ar: "", name_en: "", role: "" });
  const streamReady = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_STREAM_API_TOKEN);
  const gulfInput = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 4 * 3600_000).toISOString().slice(0, 16) : "");

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
            Tagline (Arabic)
            <input name="tagline_ar" dir="rtl" maxLength={140} defaultValue={s.tagline_ar ?? ""} placeholder="سطر واحد يشد المشاهد" />
          </label>
          <label>
            Tagline (English)
            <input name="tagline_en" maxLength={140} defaultValue={s.tagline_en ?? ""} placeholder="One line that hooks the viewer" />
          </label>
          <label>
            Age rating
            <select name="age_rating" defaultValue={s.age_rating ?? ""}>
              <option value="">Not set</option>
              {AGE_RATINGS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tags (comma separated)
            <input name="tags" defaultValue={(s.tags ?? []).join(", ")} placeholder="ramadan, gulf, betrayal" />
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
        <h2>Genres</h2>
        <div className="row">
          {GENRES.map((g) => (
            <label key={g} className="inline">
              <input type="checkbox" name="genres" value={g} defaultChecked={(s.genres ?? []).includes(g)} /> {GENRE_LABELS[g].en} · {GENRE_LABELS[g].ar}
            </label>
          ))}
        </div>
        <h2>Cast</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          {castRows.map((c, i) => (
            <div key={i} style={{ display: "contents" }}>
              <input name={`cast_${i}_ar`} dir="rtl" defaultValue={c.name_ar} placeholder="الاسم" />
              <input name={`cast_${i}_en`} defaultValue={c.name_en} placeholder="Name" />
              <input name={`cast_${i}_role`} defaultValue={c.role} placeholder="Role, e.g. Noura" />
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>Save to add more rows (up to 12).</p>

        <h2>Chat in WhatsApp</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          What happens after a viewer sends <code>{s.code}</code> is drawn in the <Link href={`/admin/flows/${s.id}`}>Flow builder</Link>. Until you publish
          your own, the series uses the standard flow: language, trailer (if uploaded), the chat episodes below, the web link, then alerts.
        </p>
        <div className="grid3">
          <label>
            Episodes in the standard flow (0–5)
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

      {/* Artwork and trailer */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Artwork & trailer</h2>
        <p className="muted" style={{ marginTop: 0 }}>Used across the web player, WhatsApp messages and templates, and offered in the Flow builder&apos;s media picker.</p>
        <ArtworkSlots
          seriesId={s.id}
          seriesCode={s.code}
          current={{ poster_url: s.poster_url, banner_wide_url: s.banner_wide_url, banner_wa_url: s.banner_wa_url, square_url: s.square_url }}
        />
        <div className="row" style={{ marginTop: 12 }}>
          <strong>Trailer (WhatsApp, under 16 MB):</strong>
          {s.trailer_video_url ? (
            <a href={s.trailer_video_url} target="_blank" rel="noreferrer">
              current trailer
            </a>
          ) : (
            <span className="muted">none yet</span>
          )}
          <MediaUpload kind="clip" seriesCode={s.code} target="series" id={s.id} field="trailer_video_url" label="Upload ready MP4" />
        </div>
      </div>

      {/* Episodes */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Episodes ({eps.length})</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Every episode needs the full video on Cloudflare Stream for the web. Free episodes (1–{s.free_web_until_ep}) can also be sent in WhatsApp: make
          their WhatsApp version here (under 16 MB, made in your browser). English WhatsApp versions need subtitles burned in, so upload those ready-made.
          Drafts are hidden from viewers; a release time keeps a ready episode hidden until then (Gulf time).
        </p>
        <BulkEpisodes seriesId={s.id} seriesCode={s.code} freeUntil={s.free_web_until_ep} streamReady={streamReady} />
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
                    {e.number <= s.free_web_until_ep && (
                      <>
                        <input name="wa_video_url_ar" defaultValue={e.wa_video_url_ar ?? ""} placeholder="WhatsApp clip URL (Arabic)" />
                        <input name="wa_video_url_en" defaultValue={e.wa_video_url_en ?? ""} placeholder="WhatsApp clip URL (English subs)" />
                      </>
                    )}
                    <input name="coin_price_override" type="number" min={1} defaultValue={e.coin_price_override ?? ""} placeholder={`Coins (default ${s.coins_per_episode})`} />
                    <select name="ready" defaultValue={e.status === "draft" ? "draft" : "ready"} title="Draft = hidden from viewers">
                      <option value="draft">Draft (hidden)</option>
                      <option value="ready">Ready</option>
                    </select>
                    <label className="inline" style={{ fontWeight: 400 }}>
                      Release
                      <input name="release_at" type="datetime-local" defaultValue={gulfInput(e.release_at)} title="Gulf time; empty = as soon as it's live" />
                    </label>
                    <div className="row">
                      <button type="submit" className="secondary">
                        Save
                      </button>
                      <MediaUpload kind="stream" seriesCode={s.code} target="episode" id={e.id} field="stream_uid" label="Web video" />
                      {e.number <= s.free_web_until_ep && (
                        <>
                          <WhatsAppVersion episodeId={e.id} seriesCode={s.code} />
                          <MediaUpload kind="clip" seriesCode={s.code} target="episode" id={e.id} field="wa_video_url_en" label="Clip EN (ready MP4)" />
                          {e.wa_video_url_ar && (
                            <span className="muted" style={{ fontSize: 12 }}>
                              WA {e.wa_size_bytes ? `${(e.wa_size_bytes / 1048576).toFixed(1)} MB ${e.wa_size_bytes <= 16 * 1048576 ? "✓" : "⚠ over 16 MB"}` : "✓"}
                            </span>
                          )}
                        </>
                      )}
                      {e.release_at && Date.parse(e.release_at) > Date.now() && (
                        <span className="badge scheduled">releases {new Date(e.release_at).toLocaleString("en-GB", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" })}</span>
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

      {/* Media library shared with the Flow builder */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Media library</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Extra images and video cuts for messages (teasers, character cards). The Flow builder uses this same library, so upload once.
        </p>
        <SeriesMediaLibrary seriesId={s.id} initial={(assets ?? []).map((a) => ({ id: a.id, kind: a.kind, name: a.name, url: a.url, sizeBytes: a.size_bytes, createdAt: a.created_at }))} />
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
