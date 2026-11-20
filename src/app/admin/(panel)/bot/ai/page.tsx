// Build with AI: describe a scenario in words; the label's AI drafts the settings and texts;
// the admin reviews the changes and a live preview of the chat, then applies or discards.

import Link from "next/link";
import { Flash } from "@/components/admin/Flash";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { loadSeriesContext, previewDraft } from "@/lib/ai/scenario-agent";
import type { ScenarioDraft, ScenarioSettings } from "@/lib/ai/scenario-draft";
import { getAiSettings } from "@/lib/ai/settings";
import { can, requireAdmin } from "@/lib/admin/auth";
import { COPY } from "@/lib/bot/copy";
import type { Turn } from "@/lib/bot/simulate";
import { db } from "@/lib/supabase";
import { applyDraftAction, discardDraftAction, draftScenarioAction } from "../../../ai-actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // drafting can take up to two AI calls

const SETTING_LABELS: Record<keyof ScenarioSettings, string> = {
  askLanguage: "Ask language first (W1)",
  sendTrailer: "Send trailer (W2)",
  askOptIn: "Ask for alerts (W6)",
  waEpisodeCount: "Episodes in WhatsApp",
};

const EXAMPLE =
  "For this series: skip the language question (Arabic only), send the trailer, give 3 episodes in the chat, then the web link. Gulf dialect, suspenseful and short. Make the cliffhanger message hit hard.";

const show = (v: unknown) => (typeof v === "boolean" ? (v ? "On" : "Off") : String(v));

function Bubble({ turn, lang }: { turn: Turn; lang: "ar" | "en" }) {
  const dir = lang === "ar" ? "rtl" : "ltr";
  if (turn.from === "viewer") {
    return (
      <div style={{ alignSelf: "flex-end", background: "#d9fdd3", padding: "6px 10px", borderRadius: 8, maxWidth: "85%" }} dir={dir}>
        {turn.text}
      </div>
    );
  }
  const m = turn.msg;
  const body =
    m.kind === "text" || m.kind === "buttons" || m.kind === "cta_url" || m.kind === "list" ? m.body : m.kind === "video" || m.kind === "image" ? (m.caption ?? "") : `Template ${m.name}`;
  const media = (m.kind === "video" || (m.kind === "buttons" && m.header?.type === "video")) && "🎬 video";
  const buttons = m.kind === "buttons" ? m.buttons.map((b) => b.title) : m.kind === "cta_url" ? [`🔗 ${m.buttonText}`] : m.kind === "list" ? [`☰ ${m.buttonText}`] : [];
  return (
    <div style={{ alignSelf: "flex-start", background: "#fff", border: "1px solid #e5e7eb", padding: "6px 10px", borderRadius: 8, maxWidth: "85%" }} dir={dir}>
      {media && <div className="muted">{media}</div>}
      <div style={{ whiteSpace: "pre-wrap" }}>{body}</div>
      {buttons.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
          {buttons.map((b, i) => (
            <div key={i} style={{ textAlign: "center", color: "#027eb5", borderTop: "1px solid #f0f0f0", paddingTop: 4 }}>
              {b}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chat({ turns, lang }: { turns: Turn[]; lang: "ar" | "en" }) {
  return (
    <div style={{ background: "#efeae2", padding: 12, borderRadius: 8, display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 280 }}>
      <strong>{lang === "ar" ? "Arabic viewer" : "English-subtitles viewer"}</strong>
      {turns.map((t, i) => (
        <Bubble key={i} turn={t} lang={lang} />
      ))}
    </div>
  );
}

export default async function BuildWithAiPage({ searchParams }: { searchParams: Promise<{ series?: string; draft?: string; ok?: string; err?: string }> }) {
  const admin = await requireAdmin("bot");
  const sp = await searchParams;
  const ai = await getAiSettings(admin.tenantId);
  const draftId = sp.draft && /^[0-9a-f-]{36}$/.test(sp.draft) ? sp.draft : null;

  const { data: draftRow } = draftId
    ? await db().from("ai_drafts").select("id, series_id, prompt, draft, status, created_at").eq("tenant_id", admin.tenantId).eq("id", draftId).maybeSingle()
    : { data: null };
  const seriesId = draftRow?.series_id ?? (sp.series && /^[0-9a-f-]{36}$/.test(sp.series) ? sp.series : null);

  const [{ data: seriesList }, { data: recent }] = await Promise.all([
    db().from("series").select("id, code, title_en").eq("tenant_id", admin.tenantId).order("created_at"),
    db().from("ai_drafts").select("id, prompt, status, created_at, series(code)").eq("tenant_id", admin.tenantId).order("created_at", { ascending: false }).limit(8),
  ]);

  const loaded = seriesId ? await loadSeriesContext(admin.tenantId, seriesId) : null;
  const draft = (draftRow?.draft ?? null) as (ScenarioDraft & { problems?: string[] }) | null;
  const preview = loaded && draft ? await previewDraft(loaded, draft) : null;
  const notConnected = !ai.connected || !ai.enabled;

  return (
    <>
      <p className="muted" style={{ margin: 0 }}>
        <Link href="/admin/bot">← Bot messages & scenarios</Link>
      </p>
      <h1>Build with AI</h1>
      <Flash ok={sp.ok} err={sp.err} />

      {notConnected && (
        <div className="card">
          <strong>AI isn&apos;t connected for this label.</strong>{" "}
          {can(admin, "aiAccount") ? (
            <>
              Add your Claude API key in <Link href="/admin/ai">AI account</Link>.
            </>
          ) : (
            "Ask the owner to connect the label's AI account."
          )}
        </div>
      )}

      {!draft && (
        <form action={draftScenarioAction} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label>
            Series
            <select name="series_id" defaultValue={seriesId ?? ""} required>
              <option value="" disabled>
                Pick a series
              </option>
              {(seriesList ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.title_en}
                </option>
              ))}
            </select>
          </label>
          <label>
            Describe the scenario (Arabic or English)
            <textarea name="request" rows={6} maxLength={2000} required placeholder={EXAMPLE} />
          </label>
          <p className="muted" style={{ margin: 0 }}>
            The AI only drafts. You&apos;ll see every change and a preview of the chat before anything goes live. Timed reminders and broadcasts are set
            up in Sequences and Campaigns.
          </p>
          <p style={{ margin: 0 }}>
            <SubmitButton pending="Drafting… this can take up to a minute">Draft with AI</SubmitButton>
          </p>
        </form>
      )}

      {draft && draftRow && loaded && preview && (
        <>
          <div className="card">
            <p className="muted" style={{ marginTop: 0 }}>
              {loaded.series.code} · {draftRow.status === "draft" ? "Draft, not live yet" : draftRow.status === "applied" ? "Applied ✓" : "Discarded"}
            </p>
            <p style={{ whiteSpace: "pre-wrap" }}>
              <strong>Request:</strong> {draftRow.prompt}
            </p>
            {draft.summary && <p style={{ whiteSpace: "pre-wrap" }}>{draft.summary}</p>}
            {draft.notes && (
              <p style={{ whiteSpace: "pre-wrap" }}>
                <strong>Note:</strong> {draft.notes}
              </p>
            )}
            {draft.problems?.length ? (
              <p style={{ color: "#b45309" }}>Some suggestions were dropped because they broke WhatsApp limits: {draft.problems.join(" ")}</p>
            ) : null}
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Changes</h2>
            {Object.keys(draft.scenario).length === 0 && draft.messages.length === 0 && <p className="muted">No changes suggested.</p>}
            {Object.keys(draft.scenario).length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Setting</th>
                    <th>Now</th>
                    <th>Draft</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(draft.scenario) as (keyof ScenarioSettings)[]).map((k) => (
                    <tr key={k}>
                      <td>{SETTING_LABELS[k]}</td>
                      <td>{show(loaded.ctx.scenario[k])}</td>
                      <td>
                        <strong>{show(draft.scenario[k])}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {draft.messages.length > 0 && (
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th style={{ width: 200 }}>Text</th>
                    <th>Arabic: now → draft</th>
                    <th>English: now → draft</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.messages.map((m) => (
                    <tr key={m.key}>
                      <td>{COPY[m.key].label}</td>
                      {(["ar", "en"] as const).map((lang) => (
                        <td key={lang} dir={lang === "ar" ? "rtl" : "ltr"} style={{ whiteSpace: "pre-wrap", verticalAlign: "top" }}>
                          <div className="muted" style={{ textDecoration: "line-through" }}>
                            {loaded.ctx.texts[m.key][lang]}
                          </div>
                          <div>{m[lang]}</div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Preview</h2>
            <p className="muted">The real bot, run with this draft. Nothing is sent and video files are placeholders.</p>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <Chat turns={preview.ar} lang="ar" />
              <Chat turns={preview.en} lang="en" />
            </div>
          </div>

          {draftRow.status === "draft" && (
            <>
              <form action={draftScenarioAction} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <input type="hidden" name="series_id" value={draftRow.series_id} />
                <input type="hidden" name="parent_id" value={draftRow.id} />
                <label>
                  Ask for changes
                  <textarea name="request" rows={3} maxLength={2000} required placeholder="e.g. shorter buttons, more suspense in the cliffhanger, add emoji" />
                </label>
                <p style={{ margin: 0 }}>
                  <SubmitButton className="secondary" pending="Revising…">
                    Revise draft
                  </SubmitButton>
                </p>
              </form>
              <div className="row" style={{ gap: 8 }}>
                <form action={applyDraftAction}>
                  <input type="hidden" name="draft_id" value={draftRow.id} />
                  <button type="submit">Apply to {loaded.series.code}</button>
                </form>
                <form action={discardDraftAction}>
                  <input type="hidden" name="draft_id" value={draftRow.id} />
                  <button type="submit" className="secondary">
                    Discard
                  </button>
                </form>
              </div>
            </>
          )}
          {draftRow.status !== "draft" && (
            <p>
              <Link href={`/admin/bot/ai?series=${draftRow.series_id}`}>Start a new draft</Link>
            </p>
          )}
        </>
      )}

      {!draft && recent && recent.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Recent drafts</h2>
          <table>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })}</td>
                  <td>{(r.series as unknown as { code: string } | null)?.code}</td>
                  <td style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.prompt}</td>
                  <td>{r.status}</td>
                  <td>
                    <Link href={`/admin/bot/ai?draft=${r.id}`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
