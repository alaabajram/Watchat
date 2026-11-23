import Link from "next/link";

/** Tabs at the top of a series: its details page and the Story builder. */
export function SeriesTabs({ seriesId, active, story }: { seriesId: string; active: "details" | "story"; story: boolean }) {
  return (
    <nav className="series-tabs" aria-label="Series">
      <Link href={`/admin/series/${seriesId}`} aria-current={active === "details" ? "page" : undefined}>
        Series details
      </Link>
      <Link href={`/admin/series/${seriesId}/story`} aria-current={active === "story" ? "page" : undefined}>
        Story builder{story ? "" : " (off)"}
      </Link>
    </nav>
  );
}
