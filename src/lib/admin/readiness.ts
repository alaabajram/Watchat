// "Is this series ready to publish?" — one checklist for the series page, the series list and the launch wizard.
// Pure: give it the series row, its episodes, licence count and the last review decision.

export type ReadinessSeries = {
  title_ar: string | null;
  title_en: string | null;
  synopsis_ar?: string | null;
  tagline_ar?: string | null;
  genres?: string[] | null;
  poster_url?: string | null;
  banner_wa_url?: string | null;
  trailer_video_url?: string | null;
  wa_episode_count: number;
  free_web_until_ep: number;
  coins_per_episode: number;
};
export type ReadinessEpisode = { number: number; status: string; stream_uid: string | null; wa_video_url_ar: string | null };

export type CheckItem = {
  key: string;
  label: string;
  done: boolean;
  /** What's there / what's missing, in plain words. */
  detail: string;
  /** Needed before Publish works; the rest only make the series look better. */
  required: boolean;
  /** Where to fix it: the launch wizard step (2 artwork, 3 episodes, 4 price, 5 licence & review). */
  step: 1 | 2 | 3 | 4 | 5;
};

export type Readiness = { items: CheckItem[]; left: number; ready: boolean; summary: string };

export function readiness(s: ReadinessSeries, episodes: ReadinessEpisode[], licences: number, lastReview: string | null): Readiness {
  const eps = episodes.filter((e) => e.status !== "archived");
  const withVideo = eps.filter((e) => e.stream_uid).length;
  const freeMissing = eps.filter((e) => e.number <= s.free_web_until_ep && !e.stream_uid).length;
  const chat = eps.filter((e) => e.number <= s.wa_episode_count);
  const chatReady = chat.filter((e) => e.wa_video_url_ar).length;

  const items: CheckItem[] = [
    { key: "titles", label: "Titles", done: Boolean(s.title_ar && s.title_en), detail: s.title_ar && s.title_en ? "Arabic and English" : "Add both titles", required: true, step: 1 },
    { key: "poster", label: "Poster", done: Boolean(s.poster_url), detail: s.poster_url ? "Uploaded" : "Upload a vertical poster", required: true, step: 2 },
    {
      // Needed: every free episode has its video (episodes without one simply stay hidden until they do).
      key: "videos",
      label: "Episode videos",
      done: withVideo > 0 && freeMissing === 0,
      detail:
        eps.length === 0
          ? "No episodes yet"
          : `${withVideo}/${eps.length} uploaded${freeMissing ? ` · ${freeMissing} free episode${freeMissing === 1 ? "" : "s"} missing` : withVideo < eps.length ? " · the rest stay hidden until uploaded" : ""}`,
      required: true,
      step: 3,
    },
    {
      key: "chat",
      label: "WhatsApp versions",
      done: s.wa_episode_count === 0 || (chat.length > 0 && chatReady === chat.length),
      detail: s.wa_episode_count === 0 ? "No episodes sent in the chat" : `${chatReady}/${Math.max(chat.length, s.wa_episode_count)} for the chat episodes`,
      required: s.wa_episode_count > 0,
      step: 3,
    },
    {
      key: "price",
      label: "Free episodes & price",
      done: s.coins_per_episode > 0,
      detail: `${s.free_web_until_ep} free · ${s.coins_per_episode} Ping per episode after`,
      required: true,
      step: 4,
    },
    { key: "licence", label: "Licence", done: licences > 0, detail: licences > 0 ? "On record" : "Add who licensed it and where", required: true, step: 5 },
    {
      key: "review",
      label: "Content check",
      done: lastReview === "approved",
      detail: lastReview === "approved" ? "Approved as family-safe" : lastReview === "rejected" ? "Rejected: fix and check again" : "Not checked yet",
      required: true,
      step: 5,
    },
    { key: "story", label: "Story & tagline", done: Boolean(s.synopsis_ar && s.tagline_ar), detail: s.synopsis_ar && s.tagline_ar ? "Written" : "A short story and a one-line hook help viewers pick it", required: false, step: 1 },
    { key: "genres", label: "Genres", done: (s.genres ?? []).length > 0, detail: (s.genres ?? []).length ? `${(s.genres ?? []).length} chosen` : "Helps search and the assistant", required: false, step: 1 },
    { key: "banner", label: "Chat banner", done: Boolean(s.banner_wa_url), detail: s.banner_wa_url ? "Uploaded" : "Used on WhatsApp messages; the poster is used until then", required: false, step: 2 },
    { key: "trailer", label: "Trailer", done: Boolean(s.trailer_video_url), detail: s.trailer_video_url ? "Uploaded" : "Optional: sent first in the chat", required: false, step: 2 },
  ];
  const left = items.filter((i) => i.required && !i.done).length;
  return { items, left, ready: left === 0, summary: left === 0 ? "Ready to publish" : `${left} thing${left === 1 ? "" : "s"} left before publishing` };
}

/** A series code from its English title: letters of the first word(s), upper case, then a number. */
export function suggestCode(titleEn: string, taken: string[]): string {
  const letters = titleEn.toUpperCase().replace(/[^A-Z ]/g, "").split(/\s+/).filter(Boolean);
  let base = (letters.join("").slice(0, 8) || "SERIES").padEnd(3, "X");
  if (letters[0] && letters[0].length >= 3 && letters[0].length <= 8) base = letters[0];
  const used = new Set(taken.map((t) => t.toUpperCase()));
  for (let n = 1; n < 1000; n++) {
    const code = `${base}${String(n).padStart(2, "0")}`;
    if (!used.has(code)) return code;
  }
  return `${base.slice(0, 5)}${Date.now() % 1000}`;
}
