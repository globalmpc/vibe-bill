import type { Bill } from "../engine/index";
import type { Usage } from "../engine/usage";
import type { Detect } from "../detect/index";
import type { LlmPrices } from "../pricing/openrouter";
import type { Pricing } from "../pricing/schema";
import { LLM_NAMES, type Config } from "../questions/config";
import defaults from "../../data/assumptions.default.json";
import { usedEntries, type Local } from "../pricing/local";
import { approx, defaultTier, fmtInt, money } from "./index";

const WHY = defaults as unknown as Record<string, { why: string }>;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const fmt = (x: number) => { const [i, f] = String(r6(x)).split("."); return i.replace(/\B(?=(\d{3})+$)/g, ",") + (f ? "." + f : ""); };
/** Fixed-point, no exponent: 6e-7 becomes 0.0000006. */
const rate = (x: number) => x.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Markdown-escape untrusted text (also flattens newlines). */
export const md = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[\\`*_\[\]<>|]/g, "\\$&");
const code = (s: string) => "`" + s.replace(/[`\u0000-\u001f\u007f]/g, "") + "`";

export const CAVEAT = "LLM prices are OpenRouter list rates; direct-API discounts such as prompt caching or batch pricing are not included, so the actual bill may be lower.";

export const CATALOGUE: Record<string, { title: string; why: string }> = {
  keystroke_llm_call: { title: "LLM call on every keystroke", why: "Every character typed sends a request, so one message costs dozens of calls." },
  render_loop_llm_call: { title: "LLM call inside a render loop", why: "The call runs each time the component re-renders, not once per user action." },
  unbounded_history: { title: "Whole chat history sent every turn", why: "Input tokens grow with every message, so long chats get expensive fast." },
  top_model_for_trivial_task: { title: "Top-tier model for a simple task", why: "A cheaper model of the same provider would do this job for a fraction of the price." },
  no_prompt_cache: { title: "Same request sent again and again", why: "Identical requests are recomputed instead of reusing an earlier answer." },
  public_ai_endpoint_no_rate_limit: { title: "Public AI endpoint without a rate limit", why: "Anyone can call it in a loop, and you pay for every call." },
  aggressive_polling: { title: "Polling an LLM on a short timer", why: "The call fires every few seconds whether or not anything changed." },
  image_optimization_on_uploads: { title: "Every upload resized into many variants", why: "Each uploaded image is billed once per generated size." },
  select_all_egress: { title: "Queries fetch whole tables", why: "Selecting every column and row moves far more data than the page shows." },
  files_in_db: { title: "Files stored in the database", why: "Database storage costs much more per GB than object storage." },
};

export const NOT_MODELLED: Record<string, string[]> = {
  vercel: ["Active CPU ($0.128/hr)", "CDN requests ($2 per 1M)", "Extra seats ($20 each)", "Function GB-hours / provisioned memory"],
  supabase: ["Cached egress ($0.03/GB)", "MAU assumes Supabase Auth"],
  resend: ["Scale tiers", "Free plan 100 emails/day cap"],
  clerk: ["Business plan and add-ons"],
  stripe: ["International cards +1.5%", "Currency conversion +1%", "Billing 0.7%", "Disputes $15"],
};

export type ReportInput = { bill: Bill; usage: Usage; config: Config; detect: Detect; pricing: Pricing; snap: LlmPrices; project: string; tierIdx?: number; local?: Local };

export function renderReport(i: ReportInput): string {
  const { bill, usage, config, pricing, snap } = i;
  const t = i.tierIdx ?? defaultTier(bill);
  const tier = bill.tiers[t];
  const isLlm = (s: string) => Object.hasOwn(LLM_NAMES, s);
  const sav = (tr: Bill["traps"][number]) => tr.savings_by_tier?.[t];
  const o: string[] = [];
  const h = (s: string) => o.push("", s, "");

  o.push(`# vibe-bill report: ${md(i.project)}`, "", `_Estimate, not an invoice. Shown tier: ${fmtInt(tier.users)} users/month._`);

  // Verdict
  const per = tier.total / tier.users;
  const open = bill.traps.some((x) => x.id === "public_ai_endpoint_no_rate_limit");
  const best = Math.max(0, ...bill.traps.map((x) => sav(x) ?? 0));
  const partial = tier.lines.some((l) => l.amount === null); // unpriced lines are missing from the total
  const base = per >= 1 || open ? "High" : per >= 0.1 || best > 0 ? "Medium" : "Low";
  const level = partial && base === "Low" ? "Unknown" : base;
  const tail = open ? "; one AI endpoint is public with no rate limit, so abuse cost has no ceiling." : best > 0 ? `; the biggest fixable trap saves ${approx(best)}/month.` : ".";
  h("## Verdict");
  o.push(`**${level} bill risk.** ${partial ? "At least " : "About "}${money(per)} per user per month at ${fmtInt(tier.users)} users${partial ? " (priced lines only; some lines have no price)" : ""}${tail}`);

  // Bill by tier
  h("## Bill by tier");
  o.push(`| Service | ${bill.tiers.map((x) => `${fmtInt(x.users)} users`).join(" | ")} |`, `| --- | ${bill.tiers.map(() => "---").join(" | ")} |`);
  tier.lines.forEach((l, k) => {
    const cells = bill.tiers.map((x) => {
      const c = x.lines[k];
      let s = money(c.amount);
      if (c.unpriced) s += " (no price found)";
      else if (c.plan && !isLlm(c.service)) s += ` (${md(c.plan)})`;
      if (c.unverified) s += " (unverified)";
      if (c.stale) s += " (may be outdated)";
      return s;
    });
    o.push(`| ${md(l.label)}${l.traps?.length ? " ⚠" : ""} | ${cells.join(" | ")} |`);
  });
  o.push(`| **Total** | ${bill.tiers.map((x) => money(x.total)).join(" | ")} |`);

  // Traps
  h("## Cost traps");
  if (!bill.traps.length) o.push("No cost traps were found in the code that was read.");
  const ranked = bill.traps.map((tr, k) => ({ tr, k })).sort((a, b) => (sav(b.tr) ?? -1) - (sav(a.tr) ?? -1) || a.k - b.k);
  ranked.forEach(({ tr }, n) => {
    const cat = CATALOGUE[tr.id];
    const cs = tr.call_site !== null ? usage.call_sites[tr.call_site] : undefined;
    const lower = /^[A-Z][a-z]/.test(cat.title) ? cat.title.charAt(0).toLowerCase() + cat.title.slice(1) : cat.title;
    const fix = tr.fix.replace(/[`\u0000-\u001f\u007f]/g, " ");
    const prompt = cs
      ? `In this app, the "${cs.feature}" ${LLM_NAMES[cs.service]} call has a cost problem: ${lower}. ${fix}. Make the smallest change that fixes it and keep everything else working.`
      : `This app has a cost problem: ${lower}. ${fix}. Make the smallest change that fixes it and keep everything else working.`;
    o.push(`### ${n + 1}. ${cat.title} (${cs ? md(cs.feature) : "whole app"})`, "", cat.why, "");
    o.push(tr.savings_by_tier === null ? "Saving not estimated: abuse cost is unbounded."
      : `Saves ${approx(sav(tr)!)}/month at ${fmtInt(tier.users)} users (${tr.savings_by_tier.map(approx).join(" / ")} at ${bill.tiers.map((x) => fmtInt(x.users)).join(" / ")}).`);
    o.push("", `**Fix:** ${md(tr.fix)}`, "", "Prompt for Claude Code:", "```text", prompt, "```", "");
  });
  if (bill.traps.length) o.pop();

  // Assumptions
  h("## Assumptions");
  const src = (k: string) => (bill.assumption_sources[k] === "usage" ? "code analysis" : bill.assumption_sources[k] === "config" ? "config" : "default");
  o.push("| Assumption | Value | Source | Why |", "| --- | --- | --- | --- |");
  for (const [k, v] of Object.entries(bill.assumptions)) o.push(`| ${md(k)} | ${fmt(v)} | ${src(k)} | ${md(Object.hasOwn(WHY, k) ? WHY[k].why : "")} |`);
  const choices = (["models", "plans", "providers"] as const).flatMap((sec) => Object.entries(config[sec]).map(([k, v]) => [`${sec}.${k}`, v] as const)).sort((a, b) => cmp(a[0], b[0]));
  if (choices.length) {
    o.push("", "| Choice | Value | Source |", "| --- | --- | --- |");
    for (const [k, v] of choices) o.push(`| ${md(k)} | ${md(v)} | ${bill.assumed.includes(k) ? "assumed" : "answered"} |`);
  }
  o.push("", `> ${CAVEAT}`);

  // Prices
  h("## Prices");
  const llm = bill.prices_as_of.llm;
  o.push(`LLM: OpenRouter list rates (${md(llm.source === "snapshot" ? "snapshot" : llm.source === "openrouter" ? "live" : llm.source)}), fetched ${llm.date}${llm.stale ? " **may be outdated**" : ""}. https://openrouter.ai/models`);
  const plans = [...new Set(bill.tiers.flatMap((x) => x.lines.filter((l) => isLlm(l.service) && l.plan).map((l) => l.plan!)))];
  if (plans.length) {
    const stored = llm.source === "snapshot" && llm.date === snap.fetched_at;
    o.push("", "| Model | $/1M input | $/1M output |", "| --- | --- | --- |");
    for (const p of plans) {
      const m = stored && Object.hasOwn(snap.models, p) ? snap.models[p] : null;
      o.push(`| ${md(p)} | ${m ? `$${m.input_per_1m}` : "rate not stored (live fetch)"} | ${m ? `$${m.output_per_1m}` : "rate not stored (live fetch)"} |`);
    }
  }
  const seen = new Set<string>();
  for (const l of tier.lines) {
    if (isLlm(l.service) || seen.has(l.service) || !Object.hasOwn(pricing.services, l.service)) continue;
    seen.add(l.service);
    const s = pricing.services[l.service];
    o.push("", `### ${md(s.name)}`, "", `Source: ${s.source_url}, checked ${s.checked_at}${bill.prices_as_of.needs_check.includes(l.service) || s.needs_check ? " **needs check**" : ""}${bill.prices_as_of.stale.includes(l.service) ? " **may be outdated**" : ""}`, "");
    const used = [...new Set(bill.tiers.flatMap((x) => x.lines.filter((y) => y.service === l.service && y.plan).map((y) => y.plan!)))];
    for (const pn of used) {
      const p = Object.hasOwn(s.plans, pn) ? s.plans[pn] : null;
      if (!p) continue;
      const parts = [`base ${money(p.base_monthly)}/month`];
      if (p.usage_credit_usd) parts.push(`usage credit ${money(p.usage_credit_usd)}`);
      if (p.overage) parts.push("overage " + Object.entries(p.overage).map(([u, r]) => `${u} $${rate(r)}`).join(", "));
      if (p.fee) parts.push(`fee ${p.fee.percent}% + ${money(p.fee.fixed_usd)}`);
      o.push(`- ${md(pn)}: ${parts.join("; ")}`);
    }
  }
  const hints = i.detect.unknown_services.map((u) => u.hint);
  const local = i.local ? usedEntries(i.local, hints) : [];
  for (const [id, e] of local) {
    o.push("", `### ${md(e.name)}`, "", `Source: <${e.source_url}>, checked ${e.checked_at} **unverified** (found by web search at run time, not reviewed)${bill.prices_as_of.stale.includes(id) ? " **may be outdated**" : ""}`, "");
    if (e.unit !== null) o.push(`- $${rate(e.unit_price_usd!)} per ${md(e.unit)} x ${fmt(e.units_per_user_per_month!)} ${md(e.unit)}/user/month`);
    if (e.base_monthly !== null) o.push(`- base ${money(e.base_monthly)}/month`);
    o.push("- Free tiers and included quotas are not applied.");
  }
  if (bill.tiers.some((x) => x.lines.some((l) => l.unverified && (isLlm(l.service) || Object.hasOwn(pricing.services, l.service))))) o.push("", "Lines marked unverified go through a base URL whose provider is not the service's own API.");

  // Not modelled
  h("## Not modelled");
  const svcs = [...new Set(tier.lines.map((l) => l.service))].filter((s) => Object.hasOwn(NOT_MODELLED, s));
  if (!svcs.length) o.push("Nothing known for these services.");
  svcs.forEach((s, n) => { if (n) o.push(""); o.push(`**${md(pricing.services[s]?.name ?? s)}**`, ...NOT_MODELLED[s].map((x) => `- ${md(x)}`)); });

  // Can't know
  h("## What this estimate can't know");
  o.push("- Real traffic: user counts and usage per user are assumptions.", "- Negotiated discounts.", "- Free credits and startup programs.", "- Taxes.", "- Services that were not detected.");
  const unpriced = hints.filter((h) => !local.some(([, e]) => e.hints.includes(h)));
  if (unpriced.length) o.push("", "Detected but not priced: " + unpriced.map((h) => code(h)).join(", "));

  // Technical notes
  h("## Technical notes");
  o.push("| # | Feature | Service | Trigger | Location |", "| --- | --- | --- | --- | --- |");
  usage.call_sites.forEach((c, k) => o.push(`| ${k + 1} | ${md(c.feature)} | ${md(LLM_NAMES[c.service] ?? c.service)} | ${md(c.trigger)} | ${c.file ? code(c.line ? `${c.file}:${c.line}` : c.file) : "unknown"} |`));
  if (bill.traps.length) o.push("");
  for (const tr of bill.traps) o.push(`- ${md(tr.id)} → ${tr.call_site === null ? "whole app" : `call site #${tr.call_site + 1}`}`);
  return o.join("\n") + "\n";
}
