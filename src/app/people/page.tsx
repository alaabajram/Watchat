// Heroes (AI People): the roster in the neon look — group tabs, one card per hero with portrait, level badge
// (the viewer's affinity), class line, subtitle, a feature chip or voice note, stats and the big button.
// Every text and file comes from Admin → AI People; the page header from Admin → Home page.

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { BottomNav } from "@/components/home/BottomNav";
import { PlayHeader } from "@/components/play/PlayHeader";
import { SignedOut } from "@/components/play/PlayShell";
import { VoiceChip } from "@/components/play/VoiceChip";
import { affinityLevel, groupKey, heroGroups } from "@/lib/people/card";
import { AI_LABEL } from "@/lib/people/persona";
import { compact, type L } from "@/lib/play/home";
import { affinities, ensureStarter, homeContent, livePeople } from "@/lib/play/store";
import { getSessionViewer } from "@/lib/session";
import { currentTenantId } from "@/lib/supabase";
import { getBalance } from "@/lib/wallet";
import { dirFor } from "@/lib/web-copy";

export const dynamic = "force-dynamic";

const UI = {
  ar: { all: (n: number) => `كل الأبطال (${n})`, online: (n: string) => `${n} رفاق جاهزين`, lv: "مستوى", voice: "رسالة صوتية", chat: "سولف" },
  en: { all: (n: number) => `All heroes (${n})`, online: (n: string) => `${n} companions online`, lv: "Lv.", voice: "Voice note", chat: "Chat" },
};

export default async function HeroesPage({ searchParams }: { searchParams: Promise<{ lang?: string; group?: string }> }) {
  const sp = await searchParams;
  const viewer = await getSessionViewer();
  if (!viewer) return <SignedOut path="/people" lang={sp.lang} />;
  const tenantId = await currentTenantId();
  await ensureStarter(tenantId);
  const locale = viewer.uiLocale;
  const ar = locale === "ar";
  const u = UI[locale];
  const T = (x: L) => (ar ? x.ar || x.en : x.en || x.ar);
  const P = (a: string, e: string) => (ar ? a || e : e || a);
  const [balance, people, content, mine] = await Promise.all([getBalance(viewer.id), livePeople(tenantId), homeContent(tenantId), affinities(viewer.id)]);
  const groups = heroGroups(people.map((p) => p.card));
  const group = groups.some((g) => g.key === sp.group) ? sp.group : null;
  const shown = group ? people.filter((p) => groupKey(p.card.groupEn || p.card.groupAr) === group) : people;

  return (
    <div className="wc wc-app hm" dir={dirFor(locale)} lang={locale}>
      <PlayHeader locale={locale} balance={balance} />
      <main className="pl-page">
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="hm-kicker">
            [ {T(content.heroes.kicker)} ] • {u.online(compact(people.length, locale))}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 className="hm-h1" style={{ fontSize: 28 }}>{T(content.heroes.title)}</h1>
            {T(content.heroes.badge) ? <span className="hm-pill">{T(content.heroes.badge)}</span> : null}
          </div>
          <p className="hm-sub" style={{ fontSize: 14 }}>{T(content.heroes.sub)}</p>
        </section>

        {groups.length ? (
          <nav className="hr-tabs" aria-label={u.all(people.length)}>
            <Link href="/people" aria-current={!group ? "page" : undefined}>{u.all(people.length)}</Link>
            {groups.map((g) => (
              <Link key={g.key} href={`/people?group=${encodeURIComponent(g.key)}`} aria-current={group === g.key ? "page" : undefined}>
                {ar ? g.ar : g.en}
              </Link>
            ))}
          </nav>
        ) : null}

        <div className="pl-section" style={{ gap: 16 }}>
          {shown.map((p) => {
            const index = people.indexOf(p);
            const red = index % 2 === 1;
            const c = p.card;
            const level = affinityLevel(mine.get(p.id) ?? 0);
            const feature = P(c.featureAr, c.featureEn);
            return (
              <article key={p.id} className={`hm-card hr-card${red ? " hm-card-red" : ""}`} style={{ ["--hm-accent" as string]: p.color }}>
                <Link href={`/people/${p.slug}`} className="hr-top">
                  <span className="hr-portrait">
                    {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span aria-hidden="true">{p.emoji}</span>}
                    <span className="hr-level">
                      {u.lv}
                      {level} {P(c.badgeAr, c.badgeEn)}
                    </span>
                  </span>
                  <span className="hr-info">
                    <span className="hr-meta">
                      {P(c.kickerAr, c.kickerEn) ? <span className={red ? "hr-kicker hr-kicker-red" : "hr-kicker"}>[ {P(c.kickerAr, c.kickerEn)} ]</span> : <span />}
                      <span className="hr-id" dir="ltr">ID: #{String(index + 1).padStart(3, "0")}</span>
                    </span>
                    <span className="hr-name">{ar ? p.nameAr : p.nameEn}</span>
                    <span className={red ? "hr-sub hr-sub-red" : "hr-sub"}>{P(c.subtitleAr, c.subtitleEn) || P(p.tagAr, p.tagEn)}</span>
                    <span className="hr-desc">{ar ? p.roleAr : p.roleEn}</span>
                    <span className="hm-ai">{AI_LABEL[locale]}</span>
                  </span>
                </Link>
                {p.voice ? (
                  <VoiceChip src={p.voice} label={feature || u.voice} emoji={c.featureEmoji || "🎙️"} />
                ) : feature ? (
                  <span className="hr-chip">
                    <span aria-hidden="true">{c.featureEmoji || "✦"}</span>
                    <span>{feature}</span>
                  </span>
                ) : null}
                {c.stats.length ? (
                  <div className="hr-stats">
                    {c.stats.map((s, i) => (
                      <span key={i}>
                        {P(s.ar, s.en)}: <b>{s.value}</b>
                      </span>
                    ))}
                  </div>
                ) : null}
                <Link href={`/people/${p.slug}`} className={red ? "hr-cta hr-cta-red" : "hr-cta"}>
                  {P(c.ctaAr, c.ctaEn) || u.chat} ▸
                </Link>
              </article>
            );
          })}
        </div>
      </main>
      <BottomNav locale={locale} current="people" />
    </div>
  );
}
