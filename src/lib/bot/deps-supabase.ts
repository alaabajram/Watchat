// Production implementation of BotDeps on Supabase + Meta Cloud API.

import { onNewViewer } from "../economy/rewards";
import { seriesLicensed, storedViewerMarket } from "../economy/store";
import { publishedSharedFlow } from "../flows/shared-store";
import { siteUrl } from "../site/store";
import { ensurePublishedFlow } from "../flows/standard";
import type { SeriesProgress } from "../flows/engine";
import { sanitizeGraph } from "../flows/sanitize";
import { sendNamedTemplate } from "../messaging/runner";
import { hmacHex } from "../crypto";
import { env } from "../env";
import { trackEvent } from "../events";
import { mintAccountLink, mintLink, refColumns, tagLink } from "../links";
import { marketFromPhone } from "../spend/meter";
import { currentTenantId, db } from "../supabase";
import { sendWhatsApp } from "../whatsapp/client";
import type { InboundMessage } from "../whatsapp/inbound";
import { countryFromPhone } from "../phone";
import { isCopyKey, type CopyLang, type CopyOverrides } from "./copy";
import { EMPTY_STATE, type BotDeps, type ChatState, type Clip, type FlowRun, type Series, type Viewer, type ViewerLang } from "./flow";

export type SeriesRow = {
  banner_wa_url?: string | null;
  banner_wide_url?: string | null;
  square_url?: string | null;
  tagline_ar?: string | null;
  tagline_en?: string | null;
  genres?: string[] | null;
  cast_members?: { name_ar: string; name_en: string; role: string }[] | null;
  id: string;
  code: string;
  title_ar: string;
  title_en: string;
  poster_url: string | null;
  trailer_video_url: string | null;
  wa_episode_count: number;
  episodes: { count: number }[] | null;
};

export const SERIES_SELECT =
  "id, code, license_countries, title_ar, title_en, poster_url, trailer_video_url, wa_episode_count, banner_wa_url, banner_wide_url, square_url, tagline_ar, tagline_en, genres, cast_members, episodes(count)";

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
    art: { bannerWa: row.banner_wa_url ?? null, bannerWide: row.banner_wide_url ?? null, square: row.square_url ?? null },
    meta: { taglineAr: row.tagline_ar ?? null, taglineEn: row.tagline_en ?? null, genres: row.genres ?? [], cast: row.cast_members ?? [] },
  };
}

export function phoneHmac(waId: string): string {
  return hmacHex(env.phoneHashSecret, `+${waId.replace(/\D/g, "")}`);
}

/** Viewer id → hmac, filled as viewers are loaded so events never need the phone number. */
const hmacByViewer = new Map<string, string>();
/** wa_id → viewer id, so outgoing messages can be logged against the viewer without another query. */
const viewerByWaId = new Map<string, string>();

const RUN_SELECT = "series_id, version_id, node_id, status, resume_at, entry, chat_episode, web_triggered_at";
type RunRow = { series_id: string; version_id: string; node_id: string; status: FlowRun["status"]; resume_at: string | null; entry: "chat" | "web"; chat_episode: number; web_triggered_at: string | null };
const toRun = (r: RunRow): FlowRun => ({
  seriesId: r.series_id,
  versionId: r.version_id,
  nodeId: r.node_id,
  status: r.status,
  resumeAt: r.resume_at,
  entry: r.entry,
  chatEpisode: r.chat_episode,
  webTriggeredAt: r.web_triggered_at,
});

/** Furthest episode started and finished on the web, and when the viewer last watched this series. */
export async function seriesProgress(viewerId: string, seriesId: string): Promise<SeriesProgress> {
  const { data } = await db()
    .from("progress")
    .select("completed_at, updated_at, episodes!inner(number, series_id)")
    .eq("viewer_id", viewerId)
    .eq("episodes.series_id", seriesId);
  let maxStarted = 0;
  let maxCompleted = 0;
  let last: number | null = null;
  for (const row of (data ?? []) as unknown as { completed_at: string | null; updated_at: string; episodes: { number: number } }[]) {
    maxStarted = Math.max(maxStarted, row.episodes.number);
    if (row.completed_at) maxCompleted = Math.max(maxCompleted, row.episodes.number);
    last = Math.max(last ?? 0, Date.parse(row.updated_at));
  }
  return { maxStarted, maxCompleted, lastWatchedAt: last };
}

/** Let sends and events from scheduled jobs be logged against a viewer (no inbound message to learn it from). */
export function primeViewer(viewerId: string, waId: string): void {
  hmacByViewer.set(viewerId, phoneHmac(waId));
  viewerByWaId.set(waId, viewerId);
}

/** `source` tags what sent each message, for the spend meter: the chat bot, or a flow resumed by the cron / the web. */
export function createSupabaseDeps(opts: { source?: "bot" | "flow" } = {}): BotDeps {
  const source = opts.source ?? "bot";
  // Licensing in chat follows the viewer's last web country (IP), else their number's country.
  let viewerId: string | null = null;
  const licensed = async (row: { license_countries?: string[] | null }) => {
    if (!row.license_countries?.length || !viewerId) return true;
    return seriesLicensed(row.license_countries, await storedViewerMarket(viewerId));
  };
  return {
    async upsertViewer(msg: InboundMessage): Promise<Viewer> {
      const tenantId = await currentTenantId();
      const hmac = phoneHmac(msg.from);
      const { data: existing } = await db()
        .from("viewers")
        .select("id, language, pin_hint_at")
        .eq("tenant_id", tenantId)
        .eq("phone_hmac", hmac)
        .maybeSingle();

      if (existing) {
        await db()
          .from("viewers")
          .update({ last_seen_at: new Date().toISOString(), last_inbound_at: new Date().toISOString(), wa_profile_name: msg.profileName ?? null })
          .eq("id", existing.id);
        hmacByViewer.set(existing.id, hmac);
        viewerByWaId.set(msg.from, existing.id);
        viewerId = existing.id;
        return { id: existing.id, waId: msg.from, language: existing.language as ViewerLang | null, pinHintSent: Boolean(existing.pin_hint_at) };
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
            last_inbound_at: new Date().toISOString(),
            first_source_id: firstSourceId,
          },
          { onConflict: "tenant_id,phone_hmac" },
        )
        .select("id, language")
        .single();
      if (error || !created) throw new Error(`upsertViewer failed: ${error?.message}`);
      // Welcome Ping, and the invite / partner code from the first message (both exactly once).
      await onNewViewer({ viewerId: created.id, tenantId, firstText: msg.text ?? null, phoneHmac: hmac }).catch((e) =>
        console.error("[rewards] new viewer", e),
      );
      hmacByViewer.set(created.id, hmac);
      viewerByWaId.set(msg.from, created.id);
      viewerId = created.id;
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
      if (!data || !(await licensed(data as { license_countries?: string[] }))) return null; // not shown in this country
      return toSeries(data as unknown as SeriesRow);
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
        .or(`release_at.is.null,release_at.lte.${new Date().toISOString()}`) // not before its release time
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
      const rows = (data ?? []) as unknown as (SeriesRow & { license_countries?: string[] })[];
      const ok = await Promise.all(rows.map((r) => licensed(r)));
      return rows.filter((_, i) => ok[i]).map(toSeries);
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

    async getSharedFlow() {
      return publishedSharedFlow(await currentTenantId());
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

    async mintAccountLink(viewerId: string): Promise<string> {
      return mintAccountLink(viewerId);
    },

    accountUrl: async () => `${await siteUrl()}/me`,

    async markPinHintSent(viewerId: string): Promise<void> {
      await db().from("viewers").update({ pin_hint_at: new Date().toISOString() }).eq("id", viewerId);
    },

    async send(to, msg, ref): Promise<void> {
      const result = await sendWhatsApp(to, msg);
      // A link card's link was minted before the send: tag it with the card so its opens count.
      if (ref && result.ok && msg.kind === "cta_url" && msg.url.includes("/w/")) await tagLink(msg.url, ref);
      await db()
        .from("wa_messages")
        .insert({
          viewer_id: viewerByWaId.get(to) ?? null,
          direction: "out",
          wa_message_id: result.ok ? result.waMessageId : null,
          kind: msg.kind,
          category: "service",
          source,
          market: marketFromPhone(to),
          ...refColumns(ref),
          status: result.ok ? "sent" : "failed",
          error: result.ok ? null : result.error,
        });
    },

    async getPublishedFlow(seriesId) {
      return ensurePublishedFlow(await currentTenantId(), seriesId);
    },

    async getFlowVersion(versionId) {
      const { data } = await db().from("flow_versions").select("graph").eq("id", versionId).maybeSingle();
      return sanitizeGraph(data?.graph); // fills defaults for options added after a version was published
    },

    async getFlowRun(viewerId, seriesId) {
      const { data } = await db().from("flow_runs").select(RUN_SELECT).eq("viewer_id", viewerId).eq("series_id", seriesId).maybeSingle();
      return data ? toRun(data) : null;
    },

    async listFlowRuns(viewerId) {
      const { data } = await db().from("flow_runs").select(RUN_SELECT).eq("viewer_id", viewerId).order("updated_at", { ascending: false }).limit(10);
      return (data ?? []).map(toRun);
    },

    async saveFlowRun(viewerId, run) {
      const { error } = await db()
        .from("flow_runs")
        .upsert(
          {
            viewer_id: viewerId,
            tenant_id: await currentTenantId(),
            series_id: run.seriesId,
            version_id: run.versionId,
            node_id: run.nodeId,
            status: run.status,
            resume_at: run.resumeAt,
            entry: run.entry,
            chat_episode: run.chatEpisode,
            web_triggered_at: run.webTriggeredAt ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "viewer_id,series_id" },
        );
      if (error) throw new Error(`saveFlowRun failed: ${error.message}`);
    },

    async pauseOtherRuns(viewerId, activeSeriesId) {
      await db()
        .from("flow_runs")
        .update({ status: "paused", updated_at: new Date().toISOString() })
        .eq("viewer_id", viewerId)
        .eq("status", "wait")
        .neq("series_id", activeSeriesId);
    },

    async seriesProgress(viewerId, seriesId) {
      return seriesProgress(viewerId, seriesId);
    },

    async sendFlowTemplate(viewer, series, name, nodeId, headerImage) {
      const optedIn = (await this.getOptIn(viewer.id)) === "in";
      return sendNamedTemplate(
        { viewerId: viewer.id, phone: `+${viewer.waId}`, language: viewer.language, seriesId: series.id, episode: series.waEpisodeCount + 1 },
        name,
        optedIn,
        { source: "flow", ref: { type: "flow", id: series.id, node: nodeId }, headerImage },
      );
    },

    async checkCondition(viewer, series, c) {
      switch (c.check) {
        case "opted_in":
          return (await this.getOptIn(viewer.id)) === "in";
        case "language_en":
          return viewer.language === "ar_en_subs";
        case "paid": {
          const { count } = await db().from("orders").select("id", { count: "exact", head: true }).eq("viewer_id", viewer.id).eq("status", "paid");
          return (count ?? 0) > 0;
        }
        case "started":
        case "watched_within":
          return false; // answered from progress in flowEnvFor
        case "came_back":
        case "paid_since":
          return false; // sequence flows only (lib/messaging/sequence-flows)
        case "has_series":
          return true; // a series flow always has its series (Shared replies answer it in sharedEnvFor)
        case "reached_episode": {
          const { count } = await db()
            .from("progress")
            .select("episode_id, episodes!inner(number, series_id)", { count: "exact", head: true })
            .eq("viewer_id", viewer.id)
            .eq("episodes.series_id", series.id)
            .gte("episodes.number", c.episode);
          return (count ?? 0) > 0;
        }
      }
    },

    async getGrowthPicks(viewerId, suggestionId) {
      const { data } = await db()
        .from("growth_suggestions")
        .select("options, returned_at")
        .eq("id", suggestionId)
        .eq("viewer_id", viewerId)
        .eq("action", "series_picks")
        .maybeSingle();
      if (!data) return null;
      if (!data.returned_at) await db().from("growth_suggestions").update({ returned_at: new Date().toISOString() }).eq("id", suggestionId);
      return Array.isArray(data.options) ? (data.options as string[]) : [];
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
