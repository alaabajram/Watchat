// Production implementation of BotDeps on Supabase + Meta Cloud API.

import { hmacHex } from "../crypto";
import { env } from "../env";
import { trackEvent } from "../events";
import { mintLink } from "../links";
import { currentTenantId, db } from "../supabase";
import { sendWhatsApp } from "../whatsapp/client";
import type { InboundMessage } from "../whatsapp/inbound";
import { countryFromPhone } from "../phone";
import { isCopyKey, type CopyLang, type CopyOverrides } from "./copy";
import { EMPTY_STATE, type BotDeps, type ChatState, type Clip, type Series, type Viewer, type ViewerLang } from "./flow";

export type SeriesRow = {
  id: string;
  code: string;
  title_ar: string;
  title_en: string;
  poster_url: string | null;
  trailer_video_url: string | null;
  wa_episode_count: number;
  ask_language: boolean;
  send_trailer: boolean;
  ask_opt_in: boolean;
  episodes: { count: number }[] | null;
};

export const SERIES_SELECT =
  "id, code, title_ar, title_en, poster_url, trailer_video_url, wa_episode_count, ask_language, send_trailer, ask_opt_in, episodes(count)";

export function toSeries(row: SeriesRow): Series {
  return {
    id: row.id,
    code: row.code,
    titleAr: row.title_ar,
    titleEn: row.title_en,
    posterUrl: row.poster_url,
    trailerUrl: row.trailer_video_url,
    waEpisodeCount: row.wa_episode_count,
    episodeCount: row.episodes?.[0]?.count ?? 0,
    askLanguage: row.ask_language,
    sendTrailer: row.send_trailer,
    askOptIn: row.ask_opt_in,
  };
}

export function phoneHmac(waId: string): string {
  return hmacHex(env.phoneHashSecret, `+${waId.replace(/\D/g, "")}`);
}

/** Viewer id → hmac, filled as viewers are loaded so events never need the phone number. */
const hmacByViewer = new Map<string, string>();
/** wa_id → viewer id, so outgoing messages can be logged against the viewer without another query. */
const viewerByWaId = new Map<string, string>();

export function createSupabaseDeps(): BotDeps {
  return {
    async upsertViewer(msg: InboundMessage): Promise<Viewer> {
      const tenantId = await currentTenantId();
      const hmac = phoneHmac(msg.from);
      const { data: existing } = await db()
        .from("viewers")
        .select("id, language")
        .eq("tenant_id", tenantId)
        .eq("phone_hmac", hmac)
        .maybeSingle();

      if (existing) {
        await db()
          .from("viewers")
          .update({ last_seen_at: new Date().toISOString(), wa_profile_name: msg.profileName ?? null })
          .eq("id", existing.id);
        hmacByViewer.set(existing.id, hmac);
        viewerByWaId.set(msg.from, existing.id);
        return { id: existing.id, waId: msg.from, language: existing.language as ViewerLang | null };
      }

      // First contact: remember where the viewer came from (Click-to-WhatsApp ad or organic).
      let firstSourceId: string | null = null;
      if (msg.referral) {
        const { data: source } = await db()
          .from("traffic_sources")
          .insert({ tenant_id: tenantId, type: "ctwa_ad", campaign_ref: msg.referral.sourceId ?? null })
          .select("id")
          .single();
        firstSourceId = source?.id ?? null;
      }

      const { data: created, error } = await db()
        .from("viewers")
        .upsert(
          {
            tenant_id: tenantId,
            phone_e164: `+${msg.from}`,
            phone_hmac: hmac,
            wa_profile_name: msg.profileName ?? null,
            country: countryFromPhone(msg.from),
            first_source_id: firstSourceId,
          },
          { onConflict: "tenant_id,phone_hmac" },
        )
        .select("id, language")
        .single();
      if (error || !created) throw new Error(`upsertViewer failed: ${error?.message}`);
      hmacByViewer.set(created.id, hmac);
      viewerByWaId.set(msg.from, created.id);
      return { id: created.id, waId: msg.from, language: created.language as ViewerLang | null };
    },

    async getChatState(viewerId: string): Promise<ChatState> {
      const { data } = await db()
        .from("chat_state")
        .select("series_id, step, wa_episode")
        .eq("viewer_id", viewerId)
        .maybeSingle();
      if (!data) return EMPTY_STATE;
      return { seriesId: data.series_id, step: data.step, waEpisode: data.wa_episode };
    },

    async saveChatState(viewerId: string, state: ChatState): Promise<void> {
      const { error } = await db().from("chat_state").upsert({
        viewer_id: viewerId,
        series_id: state.seriesId,
        step: state.step,
        wa_episode: state.waEpisode,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(`saveChatState failed: ${error.message}`);
    },

    async setViewerLanguage(viewerId: string, lang: ViewerLang): Promise<void> {
      await db()
        .from("viewers")
        .update({ language: lang, ui_locale: lang === "ar_en_subs" ? "en" : "ar" })
        .eq("id", viewerId);
    },

    async findSeriesByCode(code: string): Promise<Series | null> {
      const tenantId = await currentTenantId();
      const { data } = await db()
        .from("series")
        .select(SERIES_SELECT)
        .eq("tenant_id", tenantId)
        .eq("code", code.toUpperCase())
        .eq("status", "live")
        .maybeSingle();
      return data ? toSeries(data as unknown as SeriesRow) : null;
    },

    async getSeries(seriesId: string): Promise<Series | null> {
      const { data } = await db().from("series").select(SERIES_SELECT).eq("id", seriesId).maybeSingle();
      return data ? toSeries(data as unknown as SeriesRow) : null;
    },

    async getClip(seriesId: string, episodeNumber: number): Promise<Clip | null> {
      const { data } = await db()
        .from("episodes")
        .select("number, title_ar, title_en, wa_video_url_ar, wa_video_url_en")
        .eq("series_id", seriesId)
        .eq("number", episodeNumber)
        .maybeSingle();
      if (!data) return null;
      return {
        number: data.number,
        titleAr: data.title_ar,
        titleEn: data.title_en,
        videoUrlAr: data.wa_video_url_ar,
        videoUrlEn: data.wa_video_url_en,
      };
    },

    async listOtherSeries(excludeSeriesId: string | null): Promise<Series[]> {
      const tenantId = await currentTenantId();
      let query = db().from("series").select(SERIES_SELECT).eq("tenant_id", tenantId).eq("status", "live").limit(10);
      if (excludeSeriesId) query = query.neq("id", excludeSeriesId);
      const { data } = await query;
      return ((data ?? []) as unknown as SeriesRow[]).map(toSeries);
    },

    async getOptIn(viewerId: string): Promise<"in" | "out" | null> {
      const { data } = await db()
        .from("opt_ins")
        .select("status")
        .eq("viewer_id", viewerId)
        .eq("topic", "new_episodes")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data?.status as "in" | "out" | undefined) ?? null;
    },

    async setOptIn(viewerId: string, status: "in" | "out", source: string): Promise<void> {
      await db().from("opt_ins").insert({ viewer_id: viewerId, topic: "new_episodes", status, source });
    },

    async getCopyOverrides(seriesId: string | null, lang: CopyLang): Promise<CopyOverrides> {
      const tenantId = await currentTenantId();
      let query = db().from("bot_messages").select("key, body, series_id").eq("tenant_id", tenantId).eq("lang", lang);
      query = seriesId ? query.or(`series_id.is.null,series_id.eq.${seriesId}`) : query.is("series_id", null);
      const { data } = await query;
      const out: CopyOverrides = {};
      // Defaults first, then the series' own overrides win.
      for (const row of [...(data ?? [])].sort((a, b) => (a.series_id ? 1 : 0) - (b.series_id ? 1 : 0))) {
        if (isCopyKey(row.key) && row.body.trim()) out[row.key] = row.body;
      }
      return out;
    },

    async confirmSpendCode(viewerId: string, code: string): Promise<boolean> {
      const { data, error } = await db().rpc("confirm_spend_code", { p_viewer: viewerId, p_code: code });
      if (error) throw new Error(`confirmSpendCode failed: ${error.message}`);
      return data === true;
    },

    async resumeEpisode(viewerId: string, series: Series): Promise<number> {
      // Highest episode the viewer has progress on; never earlier than the first web episode.
      const { data } = await db()
        .from("progress")
        .select("completed_at, episodes!inner(number, series_id)")
        .eq("viewer_id", viewerId)
        .eq("episodes.series_id", series.id);
      const rows = (data ?? []) as unknown as { completed_at: string | null; episodes: { number: number } }[];
      const firstWeb = series.waEpisodeCount + 1;
      if (rows.length === 0) return firstWeb;
      const latest = rows.reduce((a, b) => (b.episodes.number > a.episodes.number ? b : a));
      const ep = latest.completed_at ? latest.episodes.number + 1 : latest.episodes.number;
      return Math.min(Math.max(ep, firstWeb), Math.max(series.episodeCount, firstWeb));
    },

    async mintLink(viewerId: string, series: Series, episodeNumber: number): Promise<string> {
      return mintLink({ viewerId, seriesId: series.id, episodeNumber });
    },

    async send(to, msg): Promise<void> {
      const result = await sendWhatsApp(to, msg);
      await db()
        .from("wa_messages")
        .insert({
          viewer_id: viewerByWaId.get(to) ?? null,
          direction: "out",
          wa_message_id: result.ok ? result.waMessageId : null,
          kind: msg.kind,
          category: "service",
          status: result.ok ? "sent" : "failed",
          error: result.ok ? null : result.error,
        });
    },

    async track(viewerId, name, data): Promise<void> {
      await trackEvent({
        viewerHmac: hmacByViewer.get(viewerId) ?? null,
        name,
        seriesId: data?.seriesId ?? null,
        episodeNumber: data?.episode ?? null,
        props: data?.props,
      });
    },
  };
}
