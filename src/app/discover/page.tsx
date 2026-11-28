// Discover: everything else on Watchat — stories and series, rewards, My List, and what's coming next.

import Link from "next/link";
import { PlayShell, SignedOut } from "@/components/play/PlayShell";
import { playCopy } from "@/lib/play/copy";
import { getSessionViewer } from "@/lib/session";
import { getBalance } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const viewer = await getSessionViewer();
  if (!viewer) return <SignedOut path="/discover" lang={(await searchParams).lang} />;
  const locale = viewer.uiLocale;
  const t = playCopy(locale);
  const balance = await getBalance(viewer.id);
  const live = [
    { href: "/today", emoji: "🔮", title: t.fortune, hint: t.cardOfDay, color: "#f5c242" },
    { href: "/horoscope", emoji: "✨", title: t.horoscope, hint: t.horoscopeTitle, color: "#7c5cff" },
    { href: "/rooms", emoji: "💬", title: t.rooms, hint: t.roomsHint, color: "#ff5a48" },
    { href: "/people", emoji: "🤖", title: t.aiPeople, hint: t.aiPeopleHint, color: "#06b6d4" },
    { href: "/explore", emoji: "🎬", title: t.stories, hint: t.storiesHint, color: "#ec4899" },
    { href: "/rewards", emoji: "🎁", title: t.rewards, hint: t.rewardsHint, color: "#31e5a0" },
    { href: "/list", emoji: "🔖", title: t.myList, hint: t.myListHint, color: "#a39cae" },
  ];
  const soon = [
    { emoji: "🌀", title: t.whatIf, hint: t.whatIfHint },
    { emoji: "🕵️", title: t.detective, hint: t.detectiveHint },
    { emoji: "🎲", title: t.playground, hint: t.playgroundHint },
  ];
  return (
    <PlayShell locale={locale} balance={balance} nav={null}>
      <header className="pl-hero">
        <h1 className="pl-h1">{t.discoverTitle}</h1>
        <p className="pl-sub">{t.tagline}</p>
      </header>
      <div className="pl-grid2">
        {live.map((x) => (
          <Link key={x.href} href={x.href} className="pl-card pl-tile" style={{ ["--pl-accent" as string]: x.color }}>
            <span className="pl-emoji" aria-hidden="true">{x.emoji}</span>
            <span className="pl-title">{x.title}</span>
            <span className="pl-muted wc-clamp2">{x.hint}</span>
          </Link>
        ))}
        {soon.map((x) => (
          <div key={x.title} className="pl-card pl-tile" aria-disabled="true">
            <span className="pl-emoji" aria-hidden="true">{x.emoji}</span>
            <span className="pl-title">{x.title}</span>
            <span className="pl-muted wc-clamp2">{x.hint}</span>
            <span className="pl-tag" style={{ alignSelf: "flex-start" }}>{t.soon}</span>
          </div>
        ))}
      </div>
    </PlayShell>
  );
}
