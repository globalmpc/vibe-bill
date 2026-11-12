import type { Detect } from "../detect/index";
import type { LlmPrices } from "../pricing/openrouter";
import { UNITS, type Pricing, type Unit } from "../pricing/schema";
import { isStale, pricesAsOf, type PricesAsOf } from "../pricing/staleness";
import { LLM_NAMES, type Config } from "../questions/config";
import { usedEntries, type Local } from "../pricing/local";
import type { CallSite, Trigger, Usage } from "./usage";
import defaults from "../../data/assumptions.default.json";

export * from "./usage";

const DEFAULTS = defaults as unknown as Record<string, { value: unknown; why: string }>;
const DEFAULT_TIERS = DEFAULTS.tiers.value as number[];
const KEYS = Object.keys(DEFAULTS).filter((k) => k !== "tiers");

const TRIGGER_KEY: Record<Trigger, string> = {
  per_message: "messages_per_active_user_per_day", per_keystroke: "messages_per_active_user_per_day",
  per_page_view: "page_views_per_active_user_per_day", per_render: "page_views_per_active_user_per_day",
  per_poll: "polls_per_active_user_per_day", per_cron_run: "cron_runs_per_active_user_per_day",
  per_webhook: "webhooks_per_active_user_per_day", per_signup: "signups_per_active_user_per_day",
};

export type Line = {
  service: string; label: string; plan: string | null; amount: number | null;
  upgraded_from?: string; traps?: string[]; unpriced?: true; unverified?: true; stale?: true;
};
export type Bill = {
  schema: 1;
  tiers: { users: number; lines: Line[]; total: number; biggest_line: number | null; key_assumptions: string[] }[];
  traps: { id: string; call_site: number | null; fix: string; savings_by_tier: number[] | null }[];
  prices_as_of: PricesAsOf;
  assumptions: Record<string, number>;
  assumption_sources: Record<string, "usage" | "config">;
  assumed: string[];
};
export type Resolved = { values: Record<string, number>; sources: Record<string, "usage" | "config">; tiers: number[] };

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const fmt = (x: number) => {
  const [i, f] = String(r6(x)).split(".");
  return i.replace(/\B(?=(\d{3})+$)/g, ",") + (f ? "." + f : "");
};

/** Precedence: config > usage.per_user > default. Errors carry paths only. */
export function resolveAssumptions(overrides: Record<string, unknown>, perUser: Usage["per_user"]): Resolved {
  const values: Record<string, number> = {};
  const sources: Record<string, "usage" | "config"> = {};
  for (const k of KEYS) values[k] = DEFAULTS[k].value as number;
  if (perUser.emails_per_month !== undefined) { values.emails_per_user_per_month = perUser.emails_per_month; sources.emails_per_user_per_month = "usage"; }
  if (perUser.storage_mb !== undefined) { values.storage_mb_per_user = perUser.storage_mb; sources.storage_mb_per_user = "usage"; }
  let tiers = DEFAULT_TIERS;
  Object.keys(overrides).sort(cmp).forEach((k, i) => {
    if (k === "tiers") {
      const v = overrides[k];
      // ponytail: max 6 tiers keeps the receipt/report table readable; raise if someone needs more columns.
      if (!Array.isArray(v) || v.length < 1 || v.length > 6 || !v.every((x) => Number.isInteger(x) && x >= 1 && x <= 1e9)) throw new Error("config.assumptions.tiers: must be a list of 1 to 6 whole numbers");
      tiers = [...new Set(v as number[])].sort((x, y) => x - y);
      return;
    }
    if (!KEYS.includes(k)) throw new Error(`config.assumptions: key #${i} is not a known assumption`);
    const v = overrides[k];
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`config.assumptions.${k}: must be a number`);
    const ok = k === "daily_active_ratio" || k === "paying_user_ratio" ? v >= 0 && v <= 1
      : k === "days_per_month" ? v > 0 && v <= 31 : k === "poll_seconds" ? v > 0 : v >= 0 && v <= 1e9;
    if (!ok) throw new Error(`config.assumptions.${k}: out of range`);
    values[k] = v;
    sources[k] = "config";
  });
  return { values, sources: Object.fromEntries(Object.entries(sources).sort((a, b) => cmp(a[0], b[0]))), tiers };
}

type Input = { detect: Detect; config: Config; usage: Usage; assumptions: Resolved; pricing: Pricing; llm: LlmPrices; now: Date; local?: Local };
type Rec = { line: Line; site: number | null; rate: number; mult: number; tin: number; tout: number };

export function billJson(b: Bill): string {
  return JSON.stringify(b, (_k, v) => (typeof v === "number" ? r6(v) : v), 2) + "\n";
}

export function calcBill(i: Input): Bill {
  const { detect, config, usage, pricing, llm, now } = i;
  const a = i.assumptions.values;
  const TIERS = i.assumptions.tiers;
  const sites = usage.call_sites;
  const llmStale = isStale(llm.fetched_at, now);
  const localUsed = i.local ? usedEntries(i.local, detect.unknown_services.map((u) => u.hint)) : [];

  const cheapest = (svc: string, tin: number, tout: number) => {
    const prefix = svc === "openrouter" ? "~" : `~${svc}/`;
    let best: { in: number; out: number } | null = null, bestCost = Infinity, bestId = "";
    for (const id of Object.keys(llm.models)) {
      if (!id.startsWith(prefix)) continue;
      const m = llm.models[id], c = tin * m.input_per_1m + tout * m.output_per_1m;
      if (c < bestCost || (c === bestCost && id < bestId)) { best = { in: m.input_per_1m, out: m.output_per_1m }; bestCost = c; bestId = id; }
    }
    return best;
  };
  const unverified = (svc: string) => detect.flags.some((f) => f.type === "base_url" && f.service === svc && Object.hasOwn(config.providers, f.env)
    && config.providers[f.env] !== svc && config.providers[f.env] !== "openrouter");

  // skip = index of a trap to disable; cheap = call site priced on the cheapest pointer of its provider.
  const tierRecs = (N: number, skip?: number, cheap?: number): Rec[] => {
    const A = N * a.daily_active_ratio, d = a.days_per_month;
    const active = (id: string, site: number | null) => usage.traps.some((t, j) => j !== skip && t.id === id && t.call_site === site);
    const wide = (id: string) => active(id, null);

    const siteCalc = sites.map((s: CallSite, k) => {
      const rate = a[TRIGGER_KEY[s.trigger]];
      let mult = 1;
      if (active("keystroke_llm_call", k)) mult *= a.chars_per_message;
      if (active("render_loop_llm_call", k)) mult *= a.render_loop_multiplier;
      if (active("no_prompt_cache", k)) mult *= a.no_prompt_cache_multiplier;
      if (active("aggressive_polling", k)) mult *= 60 / a.poll_seconds;
      const calls = A * d * rate * mult;
      const tin = (s.est_input_tokens ?? a.default_input_tokens) * (active("unbounded_history", k) ? a.history_input_multiplier : 1);
      const tout = s.est_output_tokens ?? a.default_output_tokens;
      return { rate, mult, calls, tin, tout };
    });

    let invocations = A * d * a.page_views_per_active_user_per_day;
    for (const c of siteCalc) invocations += c.calls;
    let egress = A * d * a.egress_mb_per_active_user_per_day / 1000;
    if (wide("select_all_egress")) egress *= a.select_all_egress_multiplier;
    let db = N * a.db_mb_per_user / 1000, storage = N * a.storage_mb_per_user / 1000;
    if (wide("files_in_db")) { db += storage; storage = 0; }
    const units: Partial<Record<Unit, number>> = {
      mau: N, db_gb: db, storage_gb: storage, egress_gb: egress,
      bandwidth_gb: A * d * a.page_views_per_active_user_per_day * a.bandwidth_mb_per_page_view / 1000,
      function_invocations: invocations, function_gb_hours: 0, emails: N * a.emails_per_user_per_month,
      image_optimizations: wide("image_optimization_on_uploads") ? N * a.uploads_per_user_per_month * a.image_variants : 0,
    };

    const out: Rec[] = [];
    for (const s of detect.services) {
      if (Object.hasOwn(LLM_NAMES, s.id)) {
        sites.forEach((cs, k) => {
          if (cs.service !== s.id) return;
          const c = siteCalc[k];
          const modelId = Object.hasOwn(config.models, s.id) ? config.models[s.id] : null;
          const m = modelId !== null && Object.hasOwn(llm.models, modelId) ? llm.models[modelId] : null;
          const price = m && (cheap === k ? cheapest(s.id, c.tin, c.tout) ?? { in: m.input_per_1m, out: m.output_per_1m } : { in: m.input_per_1m, out: m.output_per_1m });
          const line: Line = { service: s.id, label: `${LLM_NAMES[s.id]}: ${cs.feature}`, plan: modelId, amount: price ? c.calls * (c.tin * price.in + c.tout * price.out) / 1e6 : null };
          const ts = [...new Set(usage.traps.filter((t) => t.call_site === k).map((t) => t.id))];
          if (ts.length) line.traps = ts;
          if (!price) line.unpriced = true;
          if (unverified(s.id)) line.unverified = true;
          if (llmStale) line.stale = true;
          out.push({ line, site: k, rate: c.rate, mult: c.mult, tin: c.tin, tout: c.tout });
        });
      } else if (Object.hasOwn(pricing.services, s.id)) {
        const svc = pricing.services[s.id];
        const orig = Object.hasOwn(config.plans, s.id) ? config.plans[s.id] : svc.default_plan;
        if (orig === "none") continue;
        let plan = orig, hops = 0;
        const over = (p: typeof svc.plans[string]) => Object.entries(p.included).some(([u, q]) => (units[u as Unit] ?? 0) > q);
        while (svc.plans[plan].overage === null && svc.plans[plan].upgrade_to && over(svc.plans[plan]) && hops++ <= Object.keys(svc.plans).length) plan = svc.plans[plan].upgrade_to!;
        const p = svc.plans[plan];
        if (p.overage === null && !p.fee && over(p)) throw new Error(`pricing: ${s.id}.${plan} exceeded with no upgrade_to`);
        let amount: number;
        if (p.fee) amount = (N * a.paying_user_ratio) * (a.avg_payment_usd * p.fee.percent / 100 + p.fee.fixed_usd);
        else {
          let o = 0;
          if (p.overage) for (const u of UNITS) if (u in p.overage) o += Math.max(0, (units[u] ?? 0) - (p.included[u] ?? 0)) * p.overage[u]!;
          amount = p.base_monthly + Math.max(0, o - (p.usage_credit_usd ?? 0));
        }
        const line: Line = { service: s.id, label: svc.name, plan, amount };
        if (plan !== orig) line.upgraded_from = orig;
        const ts = [...new Set(usage.traps.filter((t) => t.call_site === null && (s.id === "supabase" ? t.id === "select_all_egress" || t.id === "files_in_db" : s.id === "vercel" && t.id === "image_optimization_on_uploads")).map((t) => t.id))];
        if (ts.length) line.traps = ts;
        if (unverified(s.id)) line.unverified = true;
        if (isStale(svc.checked_at, now)) line.stale = true;
        out.push({ line, site: null, rate: 0, mult: 1, tin: 0, tout: 0 });
      }
    }
    // ponytail: free tiers and included quotas of unknown services are ignored (overestimate); add included_units when a real case needs it.
    for (const [id, e] of localUsed) {
      const noNumber = e.base_monthly === null && e.unit_price_usd === null;
      const amount = noNumber ? null : (e.base_monthly ?? 0) + (e.unit_price_usd === null ? 0 : N * e.units_per_user_per_month! * e.unit_price_usd);
      const line: Line = { service: id, label: e.name, plan: null, amount, unverified: true };
      if (noNumber) line.unpriced = true;
      if (isStale(e.checked_at, now)) line.stale = true;
      out.push({ line, site: null, rate: 0, mult: 1, tin: 0, tout: 0 });
    }
    return out;
  };
  const sum = (r: Rec[]) => r.reduce((s, x) => s + (x.line.amount ?? 0), 0);

  const full = TIERS.map((N) => tierRecs(N));
  const tiers = TIERS.map((N, t) => {
    const recs = full[t], lines = recs.map((r) => r.line);
    let big = null as number | null;
    lines.forEach((l, x) => { if (l.amount !== null && (big === null || l.amount > lines[big].amount!)) big = x; });
    const ka = [`${fmt(N)} users/month, ${fmt(a.daily_active_ratio * 100)}% active daily`];
    if (big !== null) {
      const b = recs[big], s = b.line.service;
      if (b.site !== null) ka.push(`${sites[b.site].feature}: ${fmt(b.rate * b.mult)} calls/active user/day, ${fmt(b.tin)} in + ${fmt(b.tout)} out tokens`);
      else if (s === "supabase") ka.push(`${fmt(a.db_mb_per_user)} MB database/user, ${fmt(a.egress_mb_per_active_user_per_day)} MB egress/active user/day`);
      else if (s === "vercel") ka.push(`${fmt(a.page_views_per_active_user_per_day)} page views/active user/day`);
      else if (s === "clerk") ka.push("every user signs in each month");
      else if (s === "resend") ka.push(`${fmt(a.emails_per_user_per_month)} emails/user/month`);
      else if (s === "stripe") ka.push(`${fmt(a.paying_user_ratio * 100)}% paying, $${fmt(a.avg_payment_usd)} average payment`);
      else if (localUsed.some(([id]) => id === s)) {
        const e = i.local!.services[s];
        ka.push(e.unit !== null ? `${e.name}: ${fmt(e.units_per_user_per_month!)} ${e.unit}/user/month` : `${e.name}: flat plan price, usage not modelled`);
      }
      let m = (b.site !== null ? big : null) as number | null;
      if (m === null) recs.forEach((r, x) => { if (r.site !== null && r.line.amount !== null && (m === null || r.line.amount > lines[m].amount!)) m = x; });
      if (m !== null) {
        const l = lines[m];
        ka.push(`model ${llm.models[l.plan!].name.replace(/^[^:]*:\s*/, "")}${config.assumed.includes(`models.${l.service}`) ? " (assumed)" : ""}`);
      }
    }
    return { users: N, lines, total: sum(recs), biggest_line: big, key_assumptions: ka };
  });

  const traps = usage.traps.map((t, j) => {
    let savings: number[] | null = null;
    if (t.id !== "public_ai_endpoint_no_rate_limit") {
      savings = TIERS.map((N, ti) => {
        const alt = t.id === "top_model_for_trivial_task" ? tierRecs(N, undefined, t.call_site!) : tierRecs(N, j);
        return Math.max(0, tiers[ti].total - sum(alt));
      });
    }
    return { id: t.id, call_site: t.call_site, fix: t.fix, savings_by_tier: savings };
  });

  const used = tiers[0].lines.length ? [...new Set(full.flatMap((r) => r.filter((x) => x.site === null).map((x) => x.line.service)))] : [];
  return {
    schema: 1, tiers, traps,
    prices_as_of: pricesAsOf({ llm, pricing, servicesUsed: detect.services.map((s) => s.id).filter((id) => used.includes(id)), now, extra: localUsed.map(([id, e]) => ({ id, checked_at: e.checked_at })) }),
    assumptions: a, assumption_sources: i.assumptions.sources, assumed: [...config.assumed],
  };
}
