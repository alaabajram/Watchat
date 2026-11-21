// Launch a series, step 1: the essentials. Everything else comes in the next steps (or later on the series page).

import Link from "next/link";
import { Flash } from "@/components/admin/Flash";
import { LaunchSteps } from "@/components/admin/ReadinessChecklist";
import { requireAdmin } from "@/lib/admin/auth";
import { GENRES, GENRE_LABELS } from "@/lib/content-meta";
import { createLaunchSeriesAction } from "../../../launch-actions";

export const dynamic = "force-dynamic";

export default async function NewSeries({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireAdmin("content");
  const sp = await searchParams;
  return (
    <>
      <p>
        <Link href="/admin/series">← All series</Link>
      </p>
      <h1>Launch a new series</h1>
      <LaunchSteps step={1} seriesId={null} />
      <Flash ok={sp.ok} err={sp.err} />
      <form action={createLaunchSeriesAction} className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="grid2">
          <label>
            Title in Arabic *
            <input name="title_ar" dir="rtl" required maxLength={120} placeholder="أسرار الصحراء" />
          </label>
          <label>
            Title in English *
            <input name="title_en" required maxLength={120} placeholder="Desert Secrets" />
          </label>
          <label>
            One-line hook (Arabic)
            <input name="tagline_ar" dir="rtl" maxLength={140} placeholder="سطر واحد يشد المشاهد" />
          </label>
          <label>
            One-line hook (English)
            <input name="tagline_en" maxLength={140} placeholder="One line that makes people want to watch" />
          </label>
          <label>
            Story (Arabic)
            <textarea name="synopsis_ar" dir="rtl" maxLength={1000} rows={3} />
          </label>
          <label>
            Story (English)
            <textarea name="synopsis_en" maxLength={1000} rows={3} />
          </label>
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>Genres</legend>
          <div className="row">
            {GENRES.map((g) => (
              <label key={g} className="inline">
                <input type="checkbox" name="genres" value={g} /> {GENRE_LABELS[g].en} · {GENRE_LABELS[g].ar}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid3">
          <label>
            How many episodes?
            <input name="episodes" type="number" min={1} max={200} defaultValue={30} required />
          </label>
          <label>
            Dialect
            <select name="dialect" defaultValue="gulf">
              <option value="gulf">Gulf</option>
              <option value="egyptian">Egyptian</option>
              <option value="levantine">Levantine</option>
              <option value="msa">Modern Standard Arabic</option>
            </select>
          </label>
          <label>
            Chat code (optional)
            <input name="code" maxLength={20} placeholder="Made from the title, e.g. DESERT01" style={{ textTransform: "uppercase" }} />
          </label>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          The chat code is what viewers send in WhatsApp or Telegram to start the series. Leave it empty and we&apos;ll make one from the English title.
          Cast, tags and age rating can be added later on the series page.
        </p>
        <div>
          <button type="submit">Create and continue →</button>
        </div>
      </form>
    </>
  );
}
