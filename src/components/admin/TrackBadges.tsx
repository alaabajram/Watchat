// One line per episode: which languages it has (English subtitles / dub on the web video, English chat version).

import { removeEpisodeTrack } from "@/app/admin/content-actions";
import { LANGS, type EpisodeTracks, type LangKey, type TrackState } from "@/lib/storage/tracks";

const STATE: Record<TrackState["stream"], string> = { attached: "✓", pending: "⏳ waiting for the video", error: "⚠" };

export function TrackBadges({ episodeId, tracks, hasEnClip, chat }: { episodeId: string; tracks: EpisodeTracks; hasEnClip: boolean; chat: boolean }) {
  const items: { kind: "subs" | "audio"; lang: string; label: string; state: TrackState }[] = [];
  for (const [lang, st] of Object.entries(tracks.subs ?? {})) if (st) items.push({ kind: "subs", lang, label: `${(LANGS[lang as LangKey]?.en ?? lang).replace(" (Standard)", "")} subtitles`, state: st });
  for (const [lang, st] of Object.entries(tracks.audio ?? {})) if (st) items.push({ kind: "audio", lang, label: `${LANGS[lang as LangKey]?.en ?? lang} audio`, state: st });
  if (!items.length && !chat) return null;
  return (
    <span className="row" style={{ gap: 6, fontSize: 12, gridColumn: "1 / -1" }}>
      {items.map((t) => (
        <form key={`${t.kind}-${t.lang}`} action={removeEpisodeTrack} className="badge" style={{ display: "inline-flex", gap: 4, alignItems: "center" }} title={t.state.error ?? ""}>
          <input type="hidden" name="id" value={episodeId} />
          <input type="hidden" name="kind" value={t.kind} />
          <input type="hidden" name="lang" value={t.lang} />
          {t.label} {STATE[t.state.stream]}
          <button type="submit" aria-label={`Remove ${t.label}`} style={{ padding: "0 4px", fontSize: 11, lineHeight: 1 }} className="secondary">
            ×
          </button>
        </form>
      ))}
      {chat && <span className="badge">{hasEnClip ? "EN chat version ✓" : "no EN chat version"}</span>}
    </span>
  );
}
