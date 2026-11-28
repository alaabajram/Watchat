// Home page content (pure): every text, picture and Discover tile the team edits in Admin → Home page, with the
// defaults the page shows until they do. Pictures are stored paths ("cfimg:…", "r2:play/…", "play/…"), never
// URLs from the browser; the server turns them into links with `publicUrlFor`.

export type L = { ar: string; en: string };
export type HomeTile = { kicker: L; title: L; text: L; cta: L; href: string; image: string | null; color: string };
export type HomeContent = {
  kicker: L;
  headline: L;
  highlight: L;
  day: { title: L; sub: L; cardImage: string | null; horoscopeImage: string | null };
  rooms: { title: L; sub: L; badge: L };
  people: { title: L; sub: L; badge: L };
  discover: { title: L; tiles: HomeTile[] };
};

const l = (ar: string, en: string): L => ({ ar, en });

export const DEFAULT_HOME: HomeContent = {
  kicker: l("ساحة واتشات", "Watchat lobby"),
  headline: l("دايماً في شي ممتع", "Something interesting is"),
  highlight: l("يصير هنا.", "always happening."),
  day: { title: l("يومك في واتشات", "Your Watchat day"), sub: l("طقوس يومية، بطاقات وأبراج", "Daily rituals, cosmic cards & a daily question"), cardImage: null, horoscopeImage: null },
  rooms: { title: l("الغرف", "Rooms"), sub: l("نقاشات يومية، ألعاب وتحقيقات", "Drop into daily debates, party games & investigations"), badge: l("شغّالة", "Hub active") },
  people: { title: l("تعرّف على الشخصيات", "Meet your people"), sub: l("شخصيات ذكاء اصطناعي بحكايات ونكت وحكمة", "AI personalities with stories, jokes & wisdom"), badge: l("الطاقم", "Carnival cast") },
  discover: {
    title: l("اكتشف والعب", "Discover & play"),
    tiles: [
      {
        kicker: l("قصص ومسلسلات", "Episodes just added"),
        title: l("قصص ومسلسلات تفاعلية", "Interactive stories & series"),
        text: l("اختر نهايتك في حلقات قصيرة مشوّقة.", "Choose your ending in 5-minute thriller micro-chapters."),
        cta: l("شاهد الحين", "Binge watch"),
        href: "/explore",
        image: null,
        color: "#31e5a0",
      },
      {
        kicker: l("مكافأة يومية", "Daily rewards"),
        title: l("بينج مجاني كل يوم", "Free Ping every day"),
        text: l("ارجع كل يوم وكبّر مكافأتك.", "Come back every day and grow your bonus."),
        cta: l("استلم", "Claim"),
        href: "/rewards",
        image: null,
        color: "#ff5a48",
      },
    ],
  },
};

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

function cleanL(raw: unknown, d: L, n = 160): L {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { ar: clip(o.ar, n) || d.ar, en: clip(o.en, n) || d.en };
}

/** A stored picture path we made (anything else is dropped). */
export function cleanPath(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const p = v.trim();
  return /^cfimg:[0-9a-f-]{20,64}$/i.test(p) || /^(r2:)?play\/[A-Za-z0-9/_.-]{1,200}$/.test(p) ? p : null;
}

/** Only our own pages (or a full https link) on Discover tiles. */
export function cleanHref(v: unknown): string {
  const h = clip(v, 300);
  if (/^\/(?!\/)[A-Za-z0-9/_?=&.-]*$/.test(h)) return h;
  if (/^https:\/\/[^\s"'<>]+$/.test(h)) return h;
  return "/";
}

const cleanColor = (v: unknown, d: string) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);

export function sanitizeHome(raw: unknown): HomeContent {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown>>;
  const d = DEFAULT_HOME;
  const tilesRaw = r.discover && Array.isArray(r.discover.tiles) ? (r.discover.tiles as unknown[]) : null;
  const tiles = tilesRaw
    ? tilesRaw.slice(0, 6).map((t, i) => {
        const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
        const base = d.discover.tiles[i] ?? d.discover.tiles[0];
        return {
          kicker: cleanL(o.kicker, { ar: "", en: "" }, 60),
          title: cleanL(o.title, base.title, 80),
          text: cleanL(o.text, { ar: "", en: "" }, 200),
          cta: cleanL(o.cta, base.cta, 30),
          href: cleanHref(o.href),
          image: cleanPath(o.image),
          color: cleanColor(o.color, base.color),
        };
      })
    : d.discover.tiles;
  return {
    kicker: cleanL(r.kicker, d.kicker, 60),
    headline: cleanL(r.headline, d.headline, 80),
    highlight: cleanL(r.highlight, d.highlight, 80),
    day: {
      title: cleanL(r.day?.title, d.day.title, 60),
      sub: cleanL(r.day?.sub, d.day.sub, 120),
      cardImage: cleanPath(r.day?.cardImage),
      horoscopeImage: cleanPath(r.day?.horoscopeImage),
    },
    rooms: { title: cleanL(r.rooms?.title, d.rooms.title, 60), sub: cleanL(r.rooms?.sub, d.rooms.sub, 120), badge: cleanL(r.rooms?.badge, d.rooms.badge, 30) },
    people: { title: cleanL(r.people?.title, d.people.title, 60), sub: cleanL(r.people?.sub, d.people.sub, 120), badge: cleanL(r.people?.badge, d.people.badge, 30) },
    discover: { title: cleanL(r.discover?.title, d.discover.title, 60), tiles },
  };
}

export const HOME_SLOTS = ["hero", "tile", "wide", "hidden"] as const;
export type HomeSlot = (typeof HOME_SLOTS)[number];
export const isHomeSlot = (v: unknown): v is HomeSlot => typeof v === "string" && (HOME_SLOTS as readonly string[]).includes(v);

/** Split live rooms into the hero (the one marked hero, else the first), the grid tiles and the wide cards. */
export function homeLayout<T extends { homeSlot: HomeSlot }>(rooms: T[]): { hero: T | null; tiles: T[]; wide: T[] } {
  const shown = rooms.filter((r) => r.homeSlot !== "hidden");
  const hero = shown.find((r) => r.homeSlot === "hero") ?? shown.find((r) => r.homeSlot === "tile") ?? null;
  const rest = shown.filter((r) => r !== hero);
  return { hero, tiles: rest.filter((r) => r.homeSlot !== "wide"), wide: rest.filter((r) => r.homeSlot === "wide") };
}

/** "1.4K" style counts. */
export function compact(n: number, lang: "ar" | "en"): string {
  return new Intl.NumberFormat(lang === "ar" ? "ar" : "en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
