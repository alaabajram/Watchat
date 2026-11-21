// Dashboard date filter: a preset (today, 7/30/90 days, this month, last month) or a custom from–to,
// in the team's time zone (Asia/Dubai, UTC+4, no daylight saving). `to` is exclusive.

export const PRESETS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "month", label: "This month" },
  { key: "lastmonth", label: "Last month" },
] as const;
export type PresetKey = (typeof PRESETS)[number]["key"];

const OFFSET_MS = 4 * 3600_000; // Asia/Dubai
const DAY = 86400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD of an instant, in Dubai. */
export function dubaiDay(t: number): string {
  return new Date(t + OFFSET_MS).toISOString().slice(0, 10);
}
/** Start of a Dubai calendar day (YYYY-MM-DD) as an instant. */
export function dubaiStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) - OFFSET_MS;
}

export type DateRange = { from: Date; to: Date; fromDay: string; toDay: string; preset: PresetKey | null; label: string };

export function resolveRange(sp: { range?: string; from?: string; to?: string; days?: string }, now = Date.now()): DateRange {
  const today = dubaiDay(now);
  const make = (fromDay: string, toDay: string, preset: PresetKey | null, label: string): DateRange => ({
    from: new Date(dubaiStart(fromDay)),
    to: new Date(dubaiStart(toDay) + DAY),
    fromDay,
    toDay,
    preset,
    label,
  });
  const back = (n: number) => dubaiDay(dubaiStart(today) - (n - 1) * DAY);

  // Custom range (valid dates, from ≤ to, at most 2 years).
  if (sp.from && sp.to && ISO_DAY.test(sp.from) && ISO_DAY.test(sp.to) && !Number.isNaN(Date.parse(sp.from)) && !Number.isNaN(Date.parse(sp.to))) {
    let [a, b] = [sp.from, sp.to];
    if (a > b) [a, b] = [b, a];
    if (dubaiStart(b) - dubaiStart(a) <= 731 * DAY) return make(a, b, null, `${a} → ${b}`);
  }
  const key = (sp.range ?? (sp.days ? `${sp.days}d` : "30d")) as PresetKey;
  switch (key) {
    case "today":
      return make(today, today, "today", "Today");
    case "7d":
      return make(back(7), today, "7d", "Last 7 days");
    case "90d":
      return make(back(90), today, "90d", "Last 90 days");
    case "month":
      return make(`${today.slice(0, 7)}-01`, today, "month", "This month");
    case "lastmonth": {
      const firstThis = `${today.slice(0, 7)}-01`;
      const lastPrev = dubaiDay(dubaiStart(firstThis) - DAY);
      return make(`${lastPrev.slice(0, 7)}-01`, lastPrev, "lastmonth", "Last month");
    }
    default:
      return make(back(30), today, "30d", "Last 30 days");
  }
}
