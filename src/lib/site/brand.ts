// Brand & site settings: defaults, colour helpers and the simple text format for Terms / Privacy / About.
// Pure (no database), shared by the server, the admin preview and tests.

export type SiteSettings = {
  appUrl: string | null;
  nameAr: string;
  nameEn: string;
  logoOnLight: string;
  logoOnDark: string;
  icon: string;
  colorPrimary: string;
  colorAccent: string;
  supportEmail: string | null;
  supportWhatsapp: string | null;
  businessEmail: string | null;
};

export const DEFAULT_SITE: SiteSettings = {
  appUrl: null,
  nameAr: "واتشات",
  nameEn: "Watchat",
  logoOnLight: "/brand/wordmark-en-dark.png",
  logoOnDark: "/brand/wordmark-en-white.png",
  icon: "/brand/emblem-mint.png",
  colorPrimary: "#31e5a0",
  colorAccent: "#ff5a48",
  supportEmail: null,
  supportWhatsapp: null,
  businessEmail: null,
};

export const PAGE_SLUGS = ["terms", "privacy", "about"] as const;
export type PageSlug = (typeof PAGE_SLUGS)[number];
export const PAGE_LABELS: Record<PageSlug, { ar: string; en: string }> = {
  terms: { ar: "الشروط والأحكام", en: "Terms of use" },
  privacy: { ar: "سياسة الخصوصية", en: "Privacy policy" },
  about: { ar: "من نحن", en: "About us" },
};

export const HEX = /^#[0-9a-fA-F]{6}$/;

/** "https://www.watchat.pro/" → "https://www.watchat.pro"; null for anything that isn't an https (or local http) address. */
export function cleanSiteUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
    if (!local && !u.hostname.includes(".")) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Mix toward black until the colour reads as text on white (contrast ≥ 4.5). */
export function readableOn(hex: string, background = "#ffffff"): string {
  let c = rgb(hex);
  for (let i = 0; i < 20 && contrast(toHex(c), background) < 4.5; i++) c = c.map((v) => v * 0.85);
  return toHex(c);
}

/** Dark or white text for a button filled with `hex`. */
export function inkOn(hex: string): string {
  return contrast("#121014", hex) >= contrast("#ffffff", hex) ? "#0b1a14" : "#ffffff";
}

/** CSS variables for the brand colours (viewer app + admin). */
export function brandCss(s: Pick<SiteSettings, "colorPrimary" | "colorAccent">): string {
  const p = HEX.test(s.colorPrimary) ? s.colorPrimary : DEFAULT_SITE.colorPrimary;
  const a = HEX.test(s.colorAccent) ? s.colorAccent : DEFAULT_SITE.colorAccent;
  return `:root{--brand-primary:${p};--brand-primary-ink:${inkOn(p)};--brand-primary-text:${readableOn(p)};--brand-accent:${a};--brand-accent-text:${readableOn(a)}}
.wc{--wc-mint:${p};--wc-mint-ink:${inkOn(p)};--wc-mint-text:${readableOn(p)};--wc-coral:${a};--wc-coral-text:${readableOn(a)}}
.admin{--a-brand:${p};--a-brand-ink:${inkOn(p)};--a-brand-text:${readableOn(p)};--a-coral:${a};--a-coral-text:${readableOn(a)}}`;
}

// ---------------------------------------------------------------------------
// Page text format: plain text with # / ## headings, "- " lists, blank lines between paragraphs,
// **bold** and [link text](https://… or /path or mailto:…). Everything else is escaped.
// ---------------------------------------------------------------------------

export type Block = { type: "h1" | "h2" | "p" | "ul"; parts: Inline[][] };
export type Inline = { text: string; bold?: boolean; href?: string };

const SAFE_HREF = /^(https:\/\/|mailto:|\/(?!\/))/i;

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else out.push(SAFE_HREF.test(m[3]) ? { text: m[2], href: m[3] } : { text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

export function parsePage(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "p", parts: [parseInline(para.join(" "))] });
    if (list.length) blocks.push({ type: "ul", parts: list.map(parseInline) });
    para = [];
    list = [];
  };
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = /^(#{1,2})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ type: h[1].length === 1 ? "h1" : "h2", parts: [parseInline(h[2])] });
      continue;
    }
    const li = /^[-•*]\s+(.*)$/.exec(line);
    if (li) {
      if (para.length) {
        blocks.push({ type: "p", parts: [parseInline(para.join(" "))] });
        para = [];
      }
      list.push(li[1]);
      continue;
    }
    if (list.length) flush();
    para.push(line);
  }
  flush();
  return blocks;
}
