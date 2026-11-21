// Launch a series, steps 2–5: artwork → episodes → free episodes & price → licence, check and publish.
// Uploads use the same components as the series page, so nothing here is a second way of doing things.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArtworkSlots } from "@/components/admin/ArtworkSlots";
import { BulkEpisodes } from "@/components/admin/BulkEpisodes";
import { Flash } from "@/components/admin/Flash";
import { MediaUpload } from "@/components/admin/MediaUpload";
import { LaunchSteps, ReadinessChecklist } from "@/components/admin/ReadinessChecklist";
import { requireAdmin } from "@/lib/admin/auth";
import { readiness } from "@/lib/admin/readiness";
import { countryName } from "@/lib/economy/countries";
import { db } from "@/lib/supabase";
import type { EpisodeTracks } from "@/lib/storage/tracks";
import { finishLaunchAction, saveLaunchPriceAction } from "../../../../launch-actions";

export const dynamic = "force-dynamic";

function Nav({ id, step, next }: { id: string; step: number; next?: string }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", marginTop: 16 }}>
      {step > 2 ? <Link href={`/admin/series/${id}/launch?step=${step - 1}`}>← Back</Link> : <span />}
      {next && (
        <Link href={`/admin/series/${id}/launch?step=${step + 1}`} className="abtn">
          {next} →
        </Link>
      )}
    </div>
  );
}

export default async function Launch({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string; ok?: string; err?: string }> }) {
  const admin = await requireAdmin("content");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const step = Math.min(5, Math.max(2, Number(sp.step) || 2));

  const [{ data: s }, { data: episodes }, { count: licences }, { data: review }, { data: markets }] = await Promise.all([
    db().from("series").select("*").eq("id", id).eq("tenant_id", admin.tenantId).maybeSingle(),
    db().from("episodes").select("number, status, stream_uid, wa_video_url_ar, tracks").eq("series_id", id).order("number"),
    db().from("licences").select("id", { count: "exact", head: true }).eq("series_id", id),
    db().from("content_reviews").select("decision").eq("series_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db().from("markets").select("country").eq("tenant_id", admin.tenantId).order("sort"),
  ]);
  if (!s) notFound();
  const eps = episodes ?? [];
  const r = readiness(s, eps, licences ?? 0, review?.decision ?? null);
  const streamReady = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_STREAM_API_TOKEN);
  const withVideo = eps.filter((e) => e.stream_uid).length;

  return (
    <>
      <p>
        <Link href={`/admin/series/${s.id}`}>← {s.code} · {s.title_en}</Link>
      </p>
      <h1>
        Launch {s.title_en} <span className="muted" style={{ fontWeight: 400 }}>· {s.code}</span>
      </h1>
      <LaunchSteps step={step} seriesId={s.id} />
      <Flash ok={sp.ok} err={sp.err} />

      {step === 2 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Artwork</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            The <strong>poster</strong> is the only one you need: it&apos;s used everywhere the others are missing. Banners make chat messages and the home
            page look better.
          </p>
          <ArtworkSlots seriesId={s.id} seriesCode={s.code} current={{ poster_url: s.poster_url, banner_wide_url: s.banner_wide_url, banner_wa_url: s.banner_wa_url, square_url: s.square_url }} />
          <div className="row" style={{ marginTop: 14 }}>
            <strong>Trailer (optional):</strong>
            {s.trailer_video_url ? <span>✓ uploaded</span> : <span className="muted">sent first in the chat when there is one · MP4 under 16 MB</span>}
            <MediaUpload kind="clip" seriesCode={s.code} target="series" id={s.id} field="trailer_video_url" label="Upload trailer" />
          </div>
          <Nav id={s.id} step={2} next={s.poster_url ? "Next: episodes" : "Skip for now"} />
        </div>
      )}

      {step === 3 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Episodes</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Drop all the episode videos at once, with any English subtitles (.srt / .vtt) and English dubs (.mp3). The episode number is read from each
            file name (ep07.mp4, ep07.en.srt). Each video goes to the web player with its subtitles and dub, and the free episodes also get small chat
            versions (Arabic, and English when there&apos;s a dub or subtitles), made in this browser. Keep this tab open while it works.
          </p>
          <BulkEpisodes
            seriesId={s.id}
            seriesCode={s.code}
            freeUntil={Math.max(s.wa_episode_count, s.free_web_until_ep)}
            streamReady={streamReady}
            existing={Object.fromEntries(eps.map((e) => [e.number, { subsEn: (e.tracks as EpisodeTracks)?.subs?.en?.url, audioEn: (e.tracks as EpisodeTracks)?.audio?.en?.url }]))}
          />
          <p style={{ marginBottom: 0 }}>
            <strong>
              {withVideo}/{eps.length}
            </strong>{" "}
            episodes have their video{withVideo < eps.length ? " · the rest can be added any time; they stay hidden until then" : " ✓"}.
          </p>
          <Nav id={s.id} step={3} next="Next: free episodes & price" />
        </div>
      )}

      {step === 4 && (
        <form action={saveLaunchPriceAction} className="card">
          <input type="hidden" name="id" value={s.id} />
          <h2 style={{ marginTop: 0 }}>Free episodes & price</h2>
          <div className="grid3">
            <label>
              Free episodes
              <input name="free_eps" type="number" min={0} max={eps.length || 200} defaultValue={s.free_web_until_ep} required />
              <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>Anyone can watch these. Episode {s.free_web_until_ep + 1} onwards needs Ping or a pass.</span>
            </label>
            <label>
              Ping per episode
              <input name="coins_per_episode" type="number" min={1} max={1000} defaultValue={s.coins_per_episode} required />
              <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>New viewers get 50 Ping, so they can unlock a few before paying.</span>
            </label>
            <label>
              Episodes sent in the chat
              <input name="chat_eps" type="number" min={0} max={5} defaultValue={s.wa_episode_count} required />
              <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>0–5, played right in WhatsApp / Telegram before the web link. Must be free.</span>
            </label>
          </div>
          <p className="muted">
            Tip: end the free episodes on a cliffhanger. Series and weekly / yearly passes are priced per country in{" "}
            <Link href="/admin/pricing">Prices &amp; Ping</Link>.
          </p>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <Link href={`/admin/series/${s.id}/launch?step=3`}>← Back</Link>
            <button type="submit">Save and continue →</button>
          </div>
        </form>
      )}

      {step === 5 && (
        <>
          <form action={finishLaunchAction} className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input type="hidden" name="id" value={s.id} />
            <h2 style={{ margin: 0 }}>Licence & publish</h2>
            {(licences ?? 0) > 0 ? (
              <p style={{ margin: 0 }}>✓ A licence is on record. More details on the series page.</p>
            ) : (
              <div className="grid3">
                <label>
                  Licensed from *
                  <input name="licensor" placeholder="Studio or producer" />
                </label>
                <label>
                  Territory
                  <input name="territory" placeholder="MENA" />
                </label>
                <label>
                  From
                  <input name="starts_on" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
                </label>
              </div>
            )}
            {(markets ?? []).length > 0 && (
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend style={{ fontWeight: 600, marginBottom: 6 }}>Show it in (leave all unticked for every country)</legend>
                <div className="row">
                  {(markets ?? []).map((m) => (
                    <label key={m.country} className="inline">
                      <input type="checkbox" name="license" value={m.country} defaultChecked={((s.license_countries as string[] | null) ?? []).includes(m.country)} /> {countryName(m.country)}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {review?.decision === "approved" ? (
              <p style={{ margin: 0 }}>✓ Content checked as family-safe.</p>
            ) : (
              <label className="inline" style={{ fontWeight: 500 }}>
                <input type="checkbox" name="family_safe" /> I watched it and the content is family-safe
              </label>
            )}
            <div className="row" style={{ justifyContent: "space-between" }}>
              <Link href={`/admin/series/${s.id}/launch?step=4`}>← Back</Link>
              <div className="row">
                <button type="submit" name="publish" value="draft" className="secondary">
                  Save as draft
                </button>
                <button type="submit" name="publish" value="live">
                  Publish now
                </button>
              </div>
            </div>
          </form>
          <div className="card">
            <ReadinessChecklist r={r} seriesId={s.id} />
          </div>
        </>
      )}
    </>
  );
}
