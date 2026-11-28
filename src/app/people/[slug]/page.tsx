/* eslint-disable @next/next/no-img-element */
// Chat with one AI person.

import { notFound } from "next/navigation";
import { PersonChat } from "@/components/play/PersonChat";
import { VoiceChip } from "@/components/play/VoiceChip";
import { PlayShell, SignedOut } from "@/components/play/PlayShell";
import { AI_LABEL } from "@/lib/people/persona";
import { chatState, personBySlug } from "@/lib/play/store";
import { getSessionViewer } from "@/lib/session";
import { currentTenantId } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function PersonPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) notFound();
  const viewer = await getSessionViewer();
  if (!viewer) return <SignedOut path={`/people/${slug}`} lang={(await searchParams).lang} />;
  const tenantId = await currentTenantId();
  const person = await personBySlug(tenantId, slug);
  if (!person) notFound();
  const locale = viewer.uiLocale;
  const ar = locale === "ar";
  const state = await chatState(tenantId, viewer.id, person);
  return (
    <PlayShell locale={locale} balance={state.balance} nav="people" backHref="/people">
      <header className="pl-person" style={{ ["--pl-accent" as string]: person.color }}>
        <span className="pl-avatar" aria-hidden="true">{person.image ? <img src={person.image} alt="" /> : person.emoji}</span>
        <div>
          <h1 className="pl-title">{ar ? person.nameAr : person.nameEn}</h1>
          <p className="pl-muted">{ar ? person.roleAr : person.roleEn}</p>
          <span className="pl-tag pl-tag-ai">{AI_LABEL[locale]}</span>
          {person.voice ? (
            <div style={{ marginTop: 8 }}>
              <VoiceChip src={person.voice} label={ar ? person.card.featureAr || "رسالة صوتية" : person.card.featureEn || "Voice note"} emoji={person.card.featureEmoji || "🎙️"} />
            </div>
          ) : null}
        </div>
      </header>
      <PersonChat
        locale={locale}
        initial={state}
        person={{ slug: person.slug, color: person.color, emoji: person.emoji, greeting: ar ? person.greetingAr : person.greetingEn, starters: person.starters.map((s) => (ar ? s.ar : s.en)) }}
      />
    </PlayShell>
  );
}
