// WhatsApp spend meter: turns message counts into dollars. Pure (no database), so it is easy to test.
//
// Meta charges per delivered message, by category and by the recipient's market. Messages are free
// when Meta says so (72 h after a Click-to-WhatsApp ad, utility inside the customer-service window),
// and the first 1,000 service replies per number each month are free. Failed messages cost nothing.
// Until Meta's status webhook arrives a message is "pending" and is costed as an estimate.

export const CATEGORIES = ["marketing", "utility", "authentication", "service"] as const;
export type Category = (typeof CATEGORIES)[number];

export const MARKETS = ["SA", "AE", "QA", "KW", "OM", "EG", "IQ", "ME_REST", "OTHER"] as const;
export type Market = (typeof MARKETS)[number];

export const MARKET_LABELS: Record<Market, string> = {
  SA: "Saudi Arabia",
  AE: "UAE",
  QA: "Qatar",
  KW: "Kuwait",
  OM: "Oman",
  EG: "Egypt",
  IQ: "Iraq",
  ME_REST: "Rest of Middle East (Bahrain, Jordan, Lebanon…)",
  OTHER: "Other countries",
};

export type Rates = Record<Market, Record<Category, number>>;

/** Meta's per-message rates in USD, effective 1 October 2026. Admins can override them on the Spend page. */
export const DEFAULT_RATES: Rates = {
  SA: { marketing: 0.06624, utility: 0.01231, authentication: 0.01231, service: 0.0107 },
  AE: { marketing: 0.06624, utility: 0.01806, authentication: 0.01806, service: 0.0157 },
  QA: { marketing: 0.03922, utility: 0.0138, authentication: 0.0138, service: 0.012 },
  KW: { marketing: 0.09108, utility: 0.0506, authentication: 0.0506, service: 0.044 },
  OM: { marketing: 0.03922, utility: 0.02841, authentication: 0.02841, service: 0.0247 },
  EG: { marketing: 0.07406, utility: 0.00414, authentication: 0.00414, service: 0.0036 },
  IQ: { marketing: 0.03922, utility: 0.00909, authentication: 0.00909, service: 0.0079 },
  ME_REST: { marketing: 0.04508, utility: 0.01047, authentication: 0.01047, service: 0.0091 },
  OTHER: { marketing: 0.06946, utility: 0.00886, authentication: 0.00886, service: 0.0077 },
};

export const FREE_SERVICE_PER_MONTH = 1000;

const PREFIXES: [string, Market][] = [
  ["966", "SA"],
  ["971", "AE"],
  ["974", "QA"],
  ["965", "KW"],
  ["968", "OM"],
  ["964", "IQ"],
  ["973", "ME_REST"],
  ["962", "ME_REST"],
  ["961", "ME_REST"],
  ["963", "ME_REST"],
  ["967", "ME_REST"],
  ["970", "ME_REST"],
  ["20", "EG"],
];

/** Rate-card market from a WhatsApp number (digits with country code). Only the market is stored. */
export function marketFromPhone(waId: string): Market {
  const digits = waId.replace(/\D/g, "");
  return PREFIXES.find(([p]) => digits.startsWith(p))?.[1] ?? "OTHER";
}

/** Saved overrides on top of the defaults; anything missing or invalid keeps the default. */
export function mergeRates(overrides: unknown): Rates {
  const out = structuredClone(DEFAULT_RATES);
  if (!overrides || typeof overrides !== "object") return out;
  for (const m of MARKETS) {
    const row = (overrides as Record<string, unknown>)[m];
    if (!row || typeof row !== "object") continue;
    for (const c of CATEGORIES) {
      const v = Number((row as Record<string, unknown>)[c]);
      if (Number.isFinite(v) && v >= 0 && v < 5) out[m][c] = v;
    }
  }
  return out;
}

export type SpendGroup = {
  day: string; // YYYY-MM-DD, Gulf time
  source: string;
  market: string;
  category: string;
  template_name: string | null;
  state: string; // billable | pending | failed | free_entry_point | free_customer_service | free
  n: number;
};

export const SOURCE_LABELS: Record<string, string> = {
  bot: "Bot chat replies",
  flow: "Flow template cards",
  sequence: "Sequences",
  campaign: "Campaigns",
  growth: "Growth agent",
  admin: "Sent by the team",
};

type Line = { count: number; cost: number };
const line = (): Line => ({ count: 0, cost: 0 });

export type SpendSummary = {
  total: number;
  estimated: number; // part of total from messages Meta hasn't priced yet
  charged: number; // messages that cost money
  messages: number; // all sent (incl. free, excl. failed)
  failed: number;
  byCategory: Record<Category, Line>;
  free: { entryPoint: number; customerService: number; allowance: number; other: number };
  bySource: Record<string, Line>;
  byMarket: Record<string, Line>;
  byTemplate: { name: string; count: number; cost: number }[];
  byDay: Record<string, number>;
};

function normCategory(c: string): Category {
  if (c.startsWith("marketing")) return "marketing";
  if (c.startsWith("authentication")) return "authentication";
  if (c === "utility") return "utility";
  return "service";
}

const asMarket = (m: string): Market => ((MARKETS as readonly string[]).includes(m) ? (m as Market) : "OTHER");

/** Cost of a month of messages. Groups must be from one calendar month (the free allowance is monthly). */
export function computeSpend(groups: SpendGroup[], rates: Rates, freeServicePerMonth = FREE_SERVICE_PER_MONTH): SpendSummary {
  const s: SpendSummary = {
    total: 0,
    estimated: 0,
    charged: 0,
    messages: 0,
    failed: 0,
    byCategory: { marketing: line(), utility: line(), authentication: line(), service: line() },
    free: { entryPoint: 0, customerService: 0, allowance: 0, other: 0 },
    bySource: {},
    byMarket: {},
    byTemplate: [],
    byDay: {},
  };
  const templates = new Map<string, Line>();
  let allowance = Math.max(0, freeServicePerMonth);

  // Oldest first, so the free service allowance goes to the first replies of the month, as Meta does.
  const sorted = [...groups].sort((a, b) => a.day.localeCompare(b.day));
  for (const g of sorted) {
    const n = Number(g.n) || 0;
    if (!n) continue;
    if (g.state === "failed") {
      s.failed += n;
      continue;
    }
    s.messages += n;
    const src = (s.bySource[g.source] ??= line());
    const mkt = (s.byMarket[g.market] ??= line());
    src.count += n;
    mkt.count += n;

    if (g.state !== "billable" && g.state !== "pending") {
      if (g.state === "free_entry_point" || g.category === "referral_conversion") s.free.entryPoint += n;
      else if (g.state === "free_customer_service") s.free.customerService += n;
      else s.free.other += n;
      continue;
    }

    const cat = normCategory(g.category);
    let paid = n;
    if (cat === "service" && allowance > 0) {
      const free = Math.min(allowance, n);
      allowance -= free;
      s.free.allowance += free;
      paid -= free;
    }
    const cost = paid * rates[asMarket(g.market)][cat];
    s.byCategory[cat].count += paid;
    s.byCategory[cat].cost += cost;
    src.cost += cost;
    mkt.cost += cost;
    s.total += cost;
    s.charged += paid;
    if (g.state === "pending") s.estimated += cost;
    s.byDay[g.day] = (s.byDay[g.day] ?? 0) + cost;
    if (g.template_name) {
      const t = templates.get(g.template_name) ?? line();
      t.count += n;
      t.cost += cost;
      templates.set(g.template_name, t);
    }
  }
  s.byTemplate = [...templates.entries()].map(([name, t]) => ({ name, ...t })).sort((a, b) => b.cost - a.cost);
  return s;
}

/** Straight-line month-end projection from the spend so far. */
export function projectMonth(spentSoFar: number, now: Date, monthStart: Date, monthEnd: Date): number {
  const elapsed = Math.max(1, now.getTime() - monthStart.getTime());
  const length = monthEnd.getTime() - monthStart.getTime();
  return elapsed >= length ? spentSoFar : (spentSoFar * length) / elapsed;
}

/** Calendar month in Gulf time (UTC+4) containing `now`, as UTC instants. */
export function gulfMonth(now: Date, offsetMonths = 0): { start: Date; end: Date; label: string } {
  const g = new Date(now.getTime() + 4 * 3600_000);
  const y = g.getUTCFullYear();
  const m = g.getUTCMonth() + offsetMonths;
  const start = new Date(Date.UTC(y, m, 1) - 4 * 3600_000);
  const end = new Date(Date.UTC(y, m + 1, 1) - 4 * 3600_000);
  const label = new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return { start, end, label };
}

export const USD_PER: Record<"AED" | "SAR", number> = { AED: 1 / 3.6725, SAR: 1 / 3.75 };

export type MeterLevel = "ok" | "alert" | "over";
export function meterLevel(spent: number, budget: number | null, alertPct: number): MeterLevel {
  if (!budget || budget <= 0) return "ok";
  if (spent >= budget) return "over";
  return spent >= (budget * alertPct) / 100 ? "alert" : "ok";
}
