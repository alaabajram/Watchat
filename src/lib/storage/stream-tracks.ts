// Attaches an episode's subtitle files and extra audio (English dub) to its Cloudflare Stream video.
// The files live in storage (R2); Stream fetches them from there. If the video isn't ready yet, the track stays
// "pending" and is attached later (when the series page opens, or when the video id is saved).

import { db } from "@/lib/supabase";
import { LANGS, pendingTracks, type EpisodeTracks, type LangKey } from "./tracks";

const API = "https://api.cloudflare.com/client/v4";

function streamConfig() {
  const account = (process.env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
  const token = (process.env.CLOUDFLARE_STREAM_API_TOKEN ?? "").trim();
  return account && token ? { account, token } : null;
}

async function cf<T>(path: string, init: RequestInit): Promise<T> {
  const c = streamConfig();
  if (!c) throw new Error("Cloudflare Stream isn't set up.");
  const res = await fetch(`${API}/accounts/${c.account}/stream${path}`, { ...init, headers: { Authorization: `Bearer ${c.token}`, ...(init.headers ?? {}) } });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: { message: string }[] };
  if (!res.ok || !json.success) throw new Error(json.errors?.[0]?.message ?? `Stream answered ${res.status}`);
  return json.result as T;
}

async function attachSubtitles(uid: string, lang: string, url: string) {
  const file = await fetch(url);
  if (!file.ok) throw new Error(`Couldn't read the subtitle file (${file.status})`);
  const form = new FormData();
  form.append("file", new Blob([await file.text()], { type: "text/vtt" }), `${lang}.vtt`);
  await cf(`/${uid}/captions/${lang}`, { method: "PUT", body: form });
}

async function attachAudio(uid: string, lang: string, url: string): Promise<string> {
  const label = LANGS[lang as LangKey]?.label ?? lang;
  // Replace an earlier track of the same language instead of piling them up.
  const existing = await cf<{ audio?: { uid: string; label: string }[] }>(`/${uid}/audio`, { method: "GET" }).catch(() => ({ audio: [] as { uid: string; label: string }[] }));
  for (const a of existing.audio ?? []) if (a.label === label) await cf(`/${uid}/audio/${a.uid}`, { method: "DELETE" }).catch(() => undefined);
  const r = await cf<{ uid: string }>(`/${uid}/audio/copy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, label }) });
  return r.uid;
}

/** Try to attach every track that isn't attached yet. Returns the updated tracks (also saved). */
export async function syncEpisodeTracks(episodeId: string): Promise<EpisodeTracks> {
  const { data: ep } = await db().from("episodes").select("stream_uid, tracks").eq("id", episodeId).maybeSingle();
  const tracks = (ep?.tracks ?? {}) as EpisodeTracks;
  const todo = pendingTracks(tracks);
  if (!ep?.stream_uid || !todo.length || !streamConfig()) return tracks;
  for (const t of todo) {
    try {
      if (t.kind === "subs") await attachSubtitles(ep.stream_uid, t.lang, t.state.url);
      else t.state.audio_uid = await attachAudio(ep.stream_uid, t.lang, t.state.url);
      t.state.stream = "attached";
      delete t.state.error;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A video still processing isn't a failure: try again later.
      t.state.stream = /not ready|processing|queued|in progress|inprogress/i.test(msg) ? "pending" : "error";
      t.state.error = msg.slice(0, 200);
    }
  }
  await db().from("episodes").update({ tracks }).eq("id", episodeId);
  return tracks;
}

/** Attach what's waiting for a whole series (called when its page opens; quick when nothing is pending). */
export async function syncSeriesTracks(seriesId: string): Promise<void> {
  if (!streamConfig()) return;
  const { data: eps } = await db().from("episodes").select("id, stream_uid, tracks").eq("series_id", seriesId).not("stream_uid", "is", null);
  const waiting = (eps ?? []).filter((e) => pendingTracks(e.tracks as EpisodeTracks).length > 0).slice(0, 10);
  await Promise.all(waiting.map((e) => syncEpisodeTracks(e.id as string)));
}

/** Take a subtitle or audio track off the Stream video (when the team removes it). */
export async function detachStreamTrack(uid: string | null, kind: "subs" | "audio", lang: string, audioUid?: string): Promise<void> {
  if (!uid || !streamConfig()) return;
  if (kind === "subs") await cf(`/${uid}/captions/${lang}`, { method: "DELETE" });
  else if (audioUid) await cf(`/${uid}/audio/${audioUid}`, { method: "DELETE" });
}

