// Heroes page cards (pure): the per-person card fields the team edits in Admin → AI People (group for the filter
// tabs, class line, portrait badge, subtitle, feature chip, up to three stats, button), the viewer's affinity
// level with each person, and the starter cards.

export type Stat = { ar: string; en: string; value: string };
export type HeroCard = {
  groupAr: string;
  groupEn: string;
  kickerAr: string;
  kickerEn: string;
  badgeAr: string;
  badgeEn: string;
  subtitleAr: string;
  subtitleEn: string;
  featureAr: string;
  featureEn: string;
  featureEmoji: string;
  stats: Stat[];
  ctaAr: string;
  ctaEn: string;
};

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Up to three stats; one per line in admin: "Arabic label | English label | value". */
export function sanitizeStats(raw: unknown): Stat[] {
  const list: unknown[] =
    typeof raw === "string"
      ? raw
          .split("\n")
          .map((l) => l.split("|").map((x) => x.trim()))
          .filter((p) => p.length >= 3)
          .map(([ar, en, value]) => ({ ar, en, value }))
      : Array.isArray(raw)
        ? raw
        : [];
  return list
    .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
    .map((s) => ({ ar: clip(s.ar, 20), en: clip(s.en, 20), value: clip(s.value, 16) }))
    .filter((s) => (s.ar || s.en) && s.value)
    .slice(0, 3);
}

export const statsText = (stats: Stat[]) => stats.map((s) => `${s.ar} | ${s.en} | ${s.value}`).join("\n");

/** Affinity: level 1 to start, one level for every 5 messages the viewer sent that person, up to 99. */
export const affinityLevel = (messages: number) => Math.min(1 + Math.floor(Math.max(messages, 0) / 5), 99);

/** The filter tabs: each distinct group, in the order people are sorted. */
export function heroGroups(people: { groupAr: string; groupEn: string }[]): { key: string; ar: string; en: string; count: number }[] {
  const out = new Map<string, { key: string; ar: string; en: string; count: number }>();
  for (const p of people) {
    const name = p.groupEn || p.groupAr;
    if (!name) continue;
    const key = groupKey(name);
    const g = out.get(key) ?? { key, ar: p.groupAr || p.groupEn, en: p.groupEn || p.groupAr, count: 0 };
    g.count += 1;
    out.set(key, g);
  }
  return [...out.values()];
}

export const groupKey = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

const s = (ar: string, en: string, value: string): Stat => ({ ar, en, value });

/** Starter card fields for the seven starter people (also filled into live rows that are still empty). */
export const STARTER_CARDS: Record<string, HeroCard> = {
  layla: { groupAr: "سوالف الشارع", groupEn: "Street & banter", kickerAr: "فئة A • نعناع", kickerEn: "Class A • Mint", badgeAr: "صريحة", badgeEn: "Honest", subtitleAr: "أختك الكبيرة الصريحة جداً", subtitleEn: "Brutally honest big sister", featureAr: "رسالة صوتية", featureEn: "Voice note", featureEmoji: "🎙️", stats: [s("الحدس", "Intuition", "98%"), s("السوالف", "Banter", "MAX")], ctaAr: "تواصل", ctaEn: "Connect" },
  "abu-saleh": { groupAr: "أساطير وحكايات", groupEn: "Mythic & story", kickerAr: "أسطوري • جمر", kickerEn: "Legendary • Ember", badgeAr: "أسطورة", badgeEn: "Legend", subtitleAr: "شيخ الحكايات", subtitleEn: "The storytelling elder", featureAr: "حكاية ملحمية جاهزة", featureEn: "Epic chronicle ready", featureEmoji: "📜", stats: [s("الحكايات", "Lore", "100%"), s("الدفء", "Warmth", "MAX")], ctaAr: "اسمع الحكاية", ctaEn: "Hear tale" },
  "chef-salma": { groupAr: "سوالف الشارع", groupEn: "Street & banter", kickerAr: "فئة S • محاربة", kickerEn: "Class S • Warrior", badgeAr: "محاربة", badgeEn: "Warrior", subtitleAr: "سيدة مطبخ منتصف الليل", subtitleEn: "Midnight kitchen master", featureAr: "مهمة الثلاجة متاحة", featureEn: "Fridge quest available", featureEmoji: "🥘", stats: [s("الحرفة", "Craft", "96%"), s("الطاقة", "Energy", "MAX"), s("السرعة", "Speed", "⚡")], ctaAr: "اطبخ معها", ctaEn: "Cook with her" },
  "coach-fahd": { groupAr: "سوالف الشارع", groupEn: "Street & banter", kickerAr: "نخبة • الحلبة", kickerEn: "Elite • Arena", badgeAr: "كابتن", badgeEn: "Captain", subtitleAr: "سوالف كورة وتحدي يومي", subtitleEn: "Football banter & daily challenger", featureAr: "نقاش الديربي شغّال", featureEn: "Derby debate active", featureEmoji: "⚽", stats: [s("التكتيك", "Tactics", "99%"), s("السوالف", "Banter", "HIGH"), s("المنافسة", "Rivalry", "HOT")], ctaAr: "تحدّاه", ctaEn: "Challenge" },
  nour: { groupAr: "أساطير وحكايات", groupEn: "Mythic & story", kickerAr: "أسطوري • سماوي", kickerEn: "Mythic • Celestial", badgeAr: "أسطورية", badgeEn: "Mythic", subtitleAr: "صانعة الكلمات الغامضة", subtitleEn: "The mystical wordsmith", featureAr: "حبر النجوم شغّال", featureEn: "Starlight ink active", featureEmoji: "✨", stats: [s("القافية", "Rhyme", "100%"), s("العمق", "Depth", "COSMIC"), s("الروح", "Soul", "PURE")], ctaAr: "اطلب بيت شعر", ctaEn: "Request verse" },
  zain: { groupAr: "سوالف الشارع", groupEn: "Street & banter", kickerAr: "سايبربنك • ألعاب", kickerEn: "Cyberpunk • Esports", badgeAr: "محترف", badgeEn: "Pro", subtitleAr: "ملك ألعاب الأركيد", subtitleEn: "Cyberpunk arcade king", featureAr: "لوبي السرعة مفتوح", featureEn: "Speedrun lobby open", featureEmoji: "🎮", stats: [s("السرعة", "APM", "420"), s("السخرية", "Sarcasm", "99%"), s("البنق", "Ping", "8ms")], ctaAr: "يلا نلعب", ctaEn: "Party up" },
  "madame-zahra": { groupAr: "أساطير وحكايات", groupEn: "Mythic & story", kickerAr: "غامضة • كونية", kickerEn: "Arcane • Cosmic", badgeAr: "عرّافة", badgeEn: "Oracle", subtitleAr: "عرّافة الحظ الغامضة", subtitleEn: "Enigmatic fortune teller", featureAr: "الكرة تلمع • جاهزة", featureEn: "Orb glowing • ready", featureEmoji: "🔮", stats: [s("العرافة", "Oracle", "MAX"), s("الغموض", "Mystery", "DEEP"), s("الكارما", "Karma", "+120")], ctaAr: "اكشف حظك", ctaEn: "Reveal fate" },
};

export function cardRow(c: HeroCard) {
  return {
    group_ar: c.groupAr,
    group_en: c.groupEn,
    kicker_ar: c.kickerAr,
    kicker_en: c.kickerEn,
    badge_ar: c.badgeAr,
    badge_en: c.badgeEn,
    subtitle_ar: c.subtitleAr,
    subtitle_en: c.subtitleEn,
    feature_ar: c.featureAr,
    feature_en: c.featureEn,
    feature_emoji: c.featureEmoji,
    stats: c.stats,
    cta_ar: c.ctaAr,
    cta_en: c.ctaEn,
  };
}

export function toCard(r: Record<string, unknown>): HeroCard {
  const t = (k: string, n = 60) => clip(r[k], n);
  return {
    groupAr: t("group_ar", 30),
    groupEn: t("group_en", 30),
    kickerAr: t("kicker_ar", 40),
    kickerEn: t("kicker_en", 40),
    badgeAr: t("badge_ar", 16),
    badgeEn: t("badge_en", 16),
    subtitleAr: t("subtitle_ar", 60),
    subtitleEn: t("subtitle_en", 60),
    featureAr: t("feature_ar", 40),
    featureEn: t("feature_en", 40),
    featureEmoji: t("feature_emoji", 8),
    stats: sanitizeStats(r.stats),
    ctaAr: t("cta_ar", 24),
    ctaEn: t("cta_en", 24),
  };
}
