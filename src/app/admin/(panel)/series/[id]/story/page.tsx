// Story builder tab of a series: episodes made of scenes (pictures, clips, sound, text) with choices and routes,
// played on the web by the story reader. The editor is StoryBuilder; saving and publishing are story-actions.ts.

import Link from "next/link";
import { notFound } from "next/navigation";
import { SeriesTabs } from "@/components/admin/SeriesTabs";
import { StoryBuilder, type BuilderEpisode } from "@/components/story/StoryBuilder";
import { requireAdmin } from "@/lib/admin/auth";
import { sanitizeCharacters, sanitizeStory } from "@/lib/story/sanitize";
import { STORY_STYLES, type StoryStyle } from "@/lib/story/types";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function StoryBuilderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ep?: string }> }) {
  const admin = await requireAdmin("content");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [{ data: s }, { data: eps }] = await Promise.all([
    db().from("series").select("id, code, title_en, title_ar, status, format, story_style, story_characters").eq("id", id).eq("tenant_id", admin.tenantId).maybeSingle(),
    db().from("episodes").select("id, number, title_ar, title_en, status, story_version, story_draft, story").eq("series_id", id).neq("status", "archived").order("number"),
  ]);
  if (!s) notFound();

  const episodes: BuilderEpisode[] = (eps ?? []).map((e) => ({
    id: e.id,
    number: e.number,
    titleAr: e.title_ar ?? "",
    titleEn: e.title_en ?? "",
    status: e.status,
    version: e.story_version ?? 0,
    draft: sanitizeStory(e.story_draft ?? e.story ?? {}),
    live: e.story ? sanitizeStory(e.story) : null,
  }));
  const style = (STORY_STYLES.find((x) => x.key === s.story_style)?.key ?? "visual_novel") as StoryStyle;
  const isStory = s.format === "story";

  return (
    <>
      <p>
        <Link href="/admin/series">← All series</Link>
      </p>
      <h1>
        {s.code} · {s.title_en} <span className={`badge ${s.status}`}>{s.status}</span>
      </h1>
      <SeriesTabs seriesId={s.id} active="story" story={isStory} />
      {isStory && (
        <p className="muted" style={{ marginTop: 0 }}>
          Build each episode from scenes: a picture or short clip, voice and music, the line someone says, and what happens next (continue, a choice, a
          premium choice paid with Ping, or a turn that depends on an earlier choice). Drafts save by themselves; viewers see an episode once you publish
          it. Free episodes, the Ping price per episode and passes are set on the series details tab, as for video series.
        </p>
      )}
      <StoryBuilder
        seriesId={s.id}
        seriesStatus={s.status}
        format={isStory ? "story" : "video"}
        style={style}
        characters={sanitizeCharacters(s.story_characters)}
        episodes={episodes}
        startEpisode={episodes.some((e) => e.id === sp.ep) ? (sp.ep as string) : null}
      />
    </>
  );
}
