// Builds what the growth agent sees: a short, phone-free summary of each viewer's activity, the catalog
// it may use, and what it should learn from (team reviews and results). Server-only.

import { db } from "../supabase";
import type { Catalog, Learning, SeriesActivity, ViewerSummary } from "./agent";

const DAY = 86400_000;
const daysAgo = (iso: string | null | undefined, now: number) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / DAY)) : null);

export async function loadCatalog(tenantId: string): Promise<Catalog> {
  const [{ data: series }, { data: templates }] = await Promise.all([
    db().from("series").select("id, code, title_ar, free_web_until_ep, episodes(count)").eq("tenant_id", tenantId).eq("status", "live"),
    db().from("wa_templates").select("name, lang, category, body, button_type, meta_status").eq("tenant_id", tenantId).eq("meta_status", "APPROVED"),
  ]);
  const byName = new Map<string, Catalog["templates"][number]>();
  for (const t of templates ?? []) if (t.lang === "ar" || !byName.has(t.name)) byName.set(t.name, { name: t.name, category: t.category, body: t.body, quickReply: t.button_type === "quick_reply" });
  return {
    series: (series ?? []).map((s) => ({ code: s.code, title: s.title_ar, episodes: (s.episodes as { count: number }[])?.[0]?.count ?? 0, freeUntil: s.free_web_until_ep })),
    templates: [...byName.values()],
  };
}

/** Latest activity per viewer: their last WhatsApp message or last web progress. */
export async function lastActivity(viewerIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!viewerIds.length) return out;
  const [{ data: viewers }, { data: progress }] = await Promise.all([
    db().from("viewers").select("id, last_inbound_at").in("id", viewerIds),
    db().from("progress").select("viewer_id, updated_at").in("viewer_id", viewerIds).order("updated_at", { ascending: false }).limit(5000),
  ]);
  for (const v of viewers ?? []) if (v.last_inbound_at) out.set(v.id, Date.parse(v.last_inbound_at));
  for (const p of progress ?? []) out.set(p.viewer_id, Math.max(out.get(p.viewer_id) ?? 0, Date.parse(p.updated_at)));
  return out;
}

export async function buildSummaries(tenantId: string, viewerIds: string[], now = Date.now()): Promise<Map<string, Omit<ViewerSummary, "ref">>> {
  const out = new Map<string, Omit<ViewerSummary, "ref">>();
  if (!viewerIds.length) return out;
  const since = new Date(now - 60 * DAY).toISOString();
  const [{ data: viewers }, { data: progress }, { data: runs }, { data: paid }, { data: messages }, { data: past }, { data: series }, activity] = await Promise.all([
    db().from("viewers").select("id, language, country").in("id", viewerIds),
    db().from("progress").select("viewer_id, completed_at, updated_at, episodes!inner(number, series_id)").in("viewer_id", viewerIds),
    db().from("flow_runs").select("viewer_id, series_id, chat_episode, updated_at").in("viewer_id", viewerIds),
    db().from("orders").select("viewer_id").in("viewer_id", viewerIds).eq("status", "paid"),
    db().from("wa_messages").select("viewer_id, template_name, created_at").in("viewer_id", viewerIds).eq("kind", "template").gte("created_at", since).order("created_at", { ascending: false }),
    db().from("growth_suggestions").select("viewer_id, action, status, created_at, sent_at, returned_at").in("viewer_id", viewerIds).gte("created_at", since).order("created_at", { ascending: false }),
    db().from("series").select("id, code, title_ar, episodes(count)").eq("tenant_id", tenantId),
    lastActivity(viewerIds),
  ]);
  const seriesById = new Map((series ?? []).map((s) => [s.id, { code: s.code as string, title: s.title_ar as string, episodes: (s.episodes as { count: number }[])?.[0]?.count ?? 0 }]));

  for (const v of viewers ?? []) {
    const per = new Map<string, { up: number; done: number; last: number }>();
    for (const p of (progress ?? []).filter((x) => x.viewer_id === v.id) as unknown as { completed_at: string | null; updated_at: string; episodes: { number: number; series_id: string } }[]) {
      const cur = per.get(p.episodes.series_id) ?? { up: 0, done: 0, last: 0 };
      cur.up = Math.max(cur.up, p.episodes.number);
      if (p.completed_at) cur.done = Math.max(cur.done, p.episodes.number);
      cur.last = Math.max(cur.last, Date.parse(p.updated_at));
      per.set(p.episodes.series_id, cur);
    }
    for (const r of (runs ?? []).filter((x) => x.viewer_id === v.id)) {
      const cur = per.get(r.series_id) ?? { up: 0, done: 0, last: 0 };
      cur.up = Math.max(cur.up, r.chat_episode);
      cur.done = Math.max(cur.done, r.chat_episode);
      if (r.chat_episode) cur.last = Math.max(cur.last, Date.parse(r.updated_at));
      per.set(r.series_id, cur);
    }
    const seriesList: SeriesActivity[] = [...per.entries()]
      .map(([id, p]) => {
        const s = seriesById.get(id);
        return s
          ? { code: s.code, title: s.title, episodes: s.episodes, watchedUpTo: p.up, finished: s.episodes > 0 && p.done >= s.episodes, lastWatchedDaysAgo: p.last ? daysAgo(new Date(p.last).toISOString(), now) : null }
          : null;
      })
      .filter((x): x is SeriesActivity => Boolean(x))
      .sort((a, b) => (a.lastWatchedDaysAgo ?? 999) - (b.lastWatchedDaysAgo ?? 999));
    const last = activity.get(v.id) ?? 0;
    out.set(v.id, {
      language: v.language === "ar_en_subs" ? "en" : "ar",
      country: v.country,
      daysSinceActive: last ? Math.floor((now - last) / DAY) : 999,
      paid: (paid ?? []).some((o) => o.viewer_id === v.id),
      series: seriesList.slice(0, 6),
      recentMessages: (messages ?? [])
        .filter((m) => m.viewer_id === v.id)
        .slice(0, 5)
        .map((m) => ({ template: m.template_name ?? "?", daysAgo: daysAgo(m.created_at, now) ?? 0, cameBack: last > Date.parse(m.created_at) })),
      pastSuggestions: (past ?? [])
        .filter((g) => g.viewer_id === v.id)
        .slice(0, 5)
        .map((g) => ({ action: g.action, status: g.status, daysAgo: daysAgo(g.created_at, now) ?? 0, cameBack: Boolean(g.returned_at) })),
    });
  }
  return out;
}

export async function loadLearning(tenantId: string, now = Date.now()): Promise<Learning> {
  const since = new Date(now - 60 * DAY).toISOString();
  const settled = new Date(now - 3 * DAY).toISOString();
  const [{ data: reviewed }, { data: sent }, { data: holdout }] = await Promise.all([
    db()
      .from("growth_suggestions")
      .select("action, template_name, status, decision_note, reason")
      .eq("tenant_id", tenantId)
      .not("decided_by", "is", null)
      .in("status", ["sent", "rejected", "failed"])
      .gte("decided_at", since)
      .order("decided_at", { ascending: false })
      .limit(40),
    db().from("growth_suggestions").select("action, template_name, sent_at, returned_at").eq("tenant_id", tenantId).eq("status", "sent").gte("sent_at", since).lte("sent_at", settled),
    db().from("growth_suggestions").select("created_at, returned_at").eq("tenant_id", tenantId).eq("status", "holdout").gte("created_at", since).lte("created_at", settled),
  ]);
  const within3 = (start: string, ret: string | null) => Boolean(ret) && Date.parse(ret!) - Date.parse(start) <= 3 * DAY;
  const results = new Map<string, { sent: number; cameBack: number }>();
  for (const s of sent ?? []) {
    const key = `${s.action}:${s.template_name ?? "-"}`;
    const r = results.get(key) ?? { sent: 0, cameBack: 0 };
    r.sent++;
    if (within3(s.sent_at!, s.returned_at)) r.cameBack++;
    results.set(key, r);
  }
  return {
    reviews: (reviewed ?? []).map((r) => ({ action: r.action, template: r.template_name, approved: r.status !== "rejected", note: r.decision_note, reason: r.reason })),
    results: [...results].map(([key, r]) => ({ key, ...r })),
    holdout: { reviewed: holdout?.length ?? 0, cameBack: (holdout ?? []).filter((h) => within3(h.created_at, h.returned_at)).length },
  };
}

/** Mark sent (and holdout) suggestions whose viewer has been active since. */
export async function refreshOutcomes(tenantId: string, now = Date.now()): Promise<number> {
  const since = new Date(now - 7 * DAY).toISOString();
  const { data } = await db()
    .from("growth_suggestions")
    .select("id, viewer_id, status, sent_at, created_at")
    .eq("tenant_id", tenantId)
    .in("status", ["sent", "holdout"])
    .is("returned_at", null)
    .gte("created_at", since)
    .limit(1000);
  const activity = await lastActivity([...new Set((data ?? []).map((d) => d.viewer_id))]);
  let n = 0;
  for (const g of data ?? []) {
    const start = Date.parse(g.status === "sent" ? (g.sent_at ?? g.created_at) : g.created_at);
    const last = activity.get(g.viewer_id) ?? 0;
    if (last > start) {
      await db().from("growth_suggestions").update({ returned_at: new Date(last).toISOString() }).eq("id", g.id);
      n++;
    }
  }
  return n;
}
