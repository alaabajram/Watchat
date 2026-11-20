// Server side of "Build with AI": load the series context, ask the label's own AI account for a
// draft, check it (one retry with the problems listed), and build a preview with the real bot flow.

import { COPY, COPY_KEYS, isCopyKey, type CopyKey, type CopyLang, type CopyOverrides } from "../bot/copy";
import { SERIES_SELECT, toSeries, type SeriesRow } from "../bot/deps-supabase";
import type { Series } from "../bot/flow";
import { simulateChat, type Turn } from "../bot/simulate";
import { db } from "../supabase";
import { AiError, callTool } from "./anthropic";
import { aiAccount, logAiUsage } from "./settings";
import { SCENARIO_TOOL, systemPrompt, validateDraft, type DraftContext, type ScenarioDraft } from "./scenario-draft";

export type LoadedSeries = { series: Series; ctx: DraftContext; overrides: Record<CopyLang, CopyOverrides> };

export async function loadSeriesContext(tenantId: string, seriesId: string): Promise<LoadedSeries | null> {
  const { data: row } = await db()
    .from("series")
    .select(`${SERIES_SELECT}, synopsis_ar, synopsis_en, dialect`)
    .eq("tenant_id", tenantId)
    .eq("id", seriesId)
    .maybeSingle();
  if (!row) return null;
  const series = toSeries(row as unknown as SeriesRow);
  const extra = row as unknown as { synopsis_ar: string | null; synopsis_en: string | null; dialect: string };

  const { data: rows } = await db()
    .from("bot_messages")
    .select("key, lang, body, series_id")
    .eq("tenant_id", tenantId)
    .or(`series_id.is.null,series_id.eq.${seriesId}`);
  const overrides: Record<CopyLang, CopyOverrides> = { ar: {}, en: {} };
  // Defaults for all series first, then this series' own texts win.
  for (const r of [...(rows ?? [])].sort((a, b) => (a.series_id ? 1 : 0) - (b.series_id ? 1 : 0))) {
    if (isCopyKey(r.key) && (r.lang === "ar" || r.lang === "en") && r.body.trim()) overrides[r.lang as CopyLang][r.key] = r.body;
  }
  const texts = Object.fromEntries(
    COPY_KEYS.map((k) => [
      k,
      { ar: overrides.ar[k] ?? COPY[k].ar, en: overrides.en[k] ?? COPY[k].en, custom: Boolean(overrides.ar[k] || overrides.en[k]) },
    ]),
  ) as DraftContext["texts"];

  return {
    series,
    overrides,
    ctx: {
      series: {
        code: series.code,
        titleAr: series.titleAr,
        titleEn: series.titleEn,
        synopsisAr: extra.synopsis_ar,
        synopsisEn: extra.synopsis_en,
        dialect: extra.dialect,
        episodeCount: series.episodeCount,
        hasTrailer: Boolean(series.trailerUrl),
      },
      scenario: {
        askLanguage: series.askLanguage,
        sendTrailer: series.sendTrailer,
        askOptIn: series.askOptIn,
        waEpisodeCount: series.waEpisodeCount,
      },
      texts,
    },
  };
}

export async function draftScenario(opts: {
  tenantId: string;
  adminId: string;
  loaded: LoadedSeries;
  request: string;
  previous?: { request: string; draft: ScenarioDraft } | null;
}): Promise<{ ok: true; draft: ScenarioDraft; problems: string[] } | { ok: false; error: string }> {
  const account = await aiAccount(opts.tenantId);
  if (!account.ok) return { ok: false, error: account.reason };

  const system = systemPrompt(opts.loaded.ctx);
  const ask = opts.previous
    ? `Earlier request: ${opts.previous.request}\n\nYour previous draft:\n${JSON.stringify(opts.previous.draft)}\n\nChange it as follows (keep everything else from the previous draft): ${opts.request}`
    : opts.request;

  let content = ask;
  let last: { draft: ScenarioDraft; problems: string[] } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await callTool({ apiKey: account.apiKey, model: account.model, system, turns: [{ role: "user", content }], tool: SCENARIO_TOOL });
      await logAiUsage({ tenantId: opts.tenantId, adminId: opts.adminId, purpose: "scenario_draft", model: account.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, ok: true });
      last = validateDraft(r.input, opts.loaded.ctx);
      if (!last.problems.length) break;
      content = `${ask}\n\nYour last answer had these problems, fix them all:\n- ${last.problems.join("\n- ")}\n\nLast answer:\n${JSON.stringify(r.input)}`;
    } catch (e) {
      const message = e instanceof AiError ? e.message : "AI request failed.";
      await logAiUsage({ tenantId: opts.tenantId, adminId: opts.adminId, purpose: "scenario_draft", model: account.model, ok: false, error: message });
      if (last) break; // keep the first draft's valid parts
      return { ok: false, error: message };
    }
  }
  return { ok: true, draft: last!.draft, problems: last!.problems };
}

/** Preview of the chat with the draft applied, in both languages. */
export async function previewDraft(loaded: LoadedSeries, draft: ScenarioDraft | null): Promise<Record<CopyLang, Turn[]>> {
  const series: Series = { ...loaded.series, ...(draft?.scenario ?? {}) };
  const overrides: Record<CopyLang, CopyOverrides> = { ar: { ...loaded.overrides.ar }, en: { ...loaded.overrides.en } };
  for (const m of draft?.messages ?? []) {
    overrides.ar[m.key as CopyKey] = m.ar;
    overrides.en[m.key as CopyKey] = m.en;
  }
  const [ar, en] = await Promise.all([simulateChat(series, overrides, "ar"), simulateChat(series, overrides, "en")]);
  return { ar, en };
}
