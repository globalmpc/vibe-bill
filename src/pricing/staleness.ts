import type { Pricing } from "./schema";

export const STALE_AFTER_DAYS = 30;
const DAY = 86_400_000;
const day = (d: string | Date) => Math.floor((typeof d === "string" ? Date.parse(d + "T00:00:00Z") : d.getTime()) / DAY);

// Stale only when strictly older than 30 days (exactly 30 is fine).
export function isStale(checked_at: string, now: Date): boolean {
  return day(now) - day(checked_at) > STALE_AFTER_DAYS;
}

export interface PricesAsOf {
  llm: { source: string; date: string; stale: boolean };
  other_oldest: string | null;
  stale: string[];
  needs_check: string[];
}

export function pricesAsOf(a: {
  llm: { source: string; fetched_at: string };
  pricing: Pricing;
  servicesUsed: string[];
  now: Date;
  extra?: { id: string; checked_at: string }[];
}): PricesAsOf {
  const used = a.servicesUsed.filter((id) => Object.hasOwn(a.pricing.services, id));
  const extra = a.extra ?? [];
  const dates = [...used.map((id) => a.pricing.services[id].checked_at), ...extra.map((x) => x.checked_at)].sort();
  return {
    llm: { source: a.llm.source, date: a.llm.fetched_at, stale: isStale(a.llm.fetched_at, a.now) },
    other_oldest: dates[0] ?? null,
    stale: [...used.filter((id) => isStale(a.pricing.services[id].checked_at, a.now)), ...extra.filter((x) => isStale(x.checked_at, a.now)).map((x) => x.id)],
    needs_check: used.filter((id) => a.pricing.services[id].needs_check),
  };
}
