import type { Detect } from "../detect/index";
import type { LlmPrices } from "../pricing/openrouter";
import { resolveModel } from "../pricing/openrouter";
import type { Pricing } from "../pricing/schema";
import { LLM_NAMES, getValue, type Config } from "./config";

export * from "./config";
export const MAX_QUESTIONS = 4, MAX_OPTIONS = 4;
export type Option = { value: string; label: string; description: string; input_per_1m?: number; output_per_1m?: number };
export type Question = {
  id: string; type: "model" | "base_url_provider" | "plan_tier"; service: string; prompt: string; note: string | null;
  options: Option[]; other: boolean; default: string | null;
};

const RANK = { model: 0, base_url_provider: 1, plan_tier: 2 };
const CONF = { high: 0, medium: 1, low: 2 };
const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

export function allQuestions(d: Detect, pricing: Pricing, llm: LlmPrices): Question[] {
  const qs: (Question & { c: number })[] = [];
  for (const s of d.services) {
    if (Object.hasOwn(LLM_NAMES, s.id)) {
      const name = LLM_NAMES[s.id];
      const toOpt = (id: string): Option => {
        const m = llm.models[id];
        return {
          value: id, label: m.name.replace(/^[^:]*:\s*/, ""), description: `$${m.input_per_1m} in / $${m.output_per_1m} out per 1M tokens`,
          input_per_1m: m.input_per_1m, output_per_1m: m.output_per_1m,
        };
      };
      const hit = s.model ? resolveModel(llm, s.id === "openrouter" ? null : s.id, s.model) : null;
      const prefix = s.id === "openrouter" ? "~" : `~${s.id}/`;
      const ptrs = Object.keys(llm.models).filter((id) => id.startsWith(prefix) && id !== hit?.id)
        .sort((a, b) => cmp(llm.models[a].input_per_1m, llm.models[b].input_per_1m) || cmp(llm.models[a].output_per_1m, llm.models[b].output_per_1m) || cmp(a, b))
        .slice(0, MAX_OPTIONS - (hit ? 1 : 0));
      const options = [...(hit ? [hit.id] : []), ...ptrs].map(toOpt);
      const note = s.model ? `found in code: ${s.model}${hit ? "" : " (no OpenRouter price)"}` : s.model_reason;
      qs.push({
        id: `models.${s.id}`, type: "model", service: s.id, prompt: `Which model does production use for ${name}?`, note, options, other: true,
        default: hit ? hit.id : ptrs.length ? ptrs[Math.floor((ptrs.length - 1) / 2)] : null, c: CONF[s.confidence],
      });
    }
    if (Object.hasOwn(pricing.services, s.id)) {
      const ps = pricing.services[s.id];
      const names = Object.keys(ps.plans);
      if (names.length > 1) qs.push({
        id: `plans.${s.id}`, type: "plan_tier", service: s.id, prompt: `Which ${ps.name} plan does production use?`,
        note: s.confidence === "low" ? `low confidence (${s.evidence.join(", ")})` : null,
        options: [
          ...names.map((p) => ({ value: p, label: p, description: `$${ps.plans[p].base_monthly}/month base` })),
          ...(s.confidence === "low" ? [{ value: "none", label: "not used", description: "Drop this service from the bill" }] : []),
        ],
        other: false, default: ps.default_plan, c: CONF[s.confidence],
      });
    }
  }
  for (const f of d.flags) {
    if (f.type !== "base_url" || !f.service || f.service === "openrouter") continue;
    const name = LLM_NAMES[f.service];
    qs.push({
      id: `providers.${f.env}`, type: "base_url_provider", service: f.service, prompt: `Which provider does ${f.env} point to in production?`, note: null,
      options: [{ value: f.service, label: name, description: `Direct ${name} API` }, { value: "openrouter", label: "OpenRouter", description: "Routed through OpenRouter" }],
      other: true, default: f.service, c: 0,
    });
  }
  return qs.sort((a, b) => RANK[a.type] - RANK[b.type] || a.c - b.c || cmp(a.id, b.id)).map(({ c: _c, ...q }) => q);
}

export function pendingQuestions(qs: Question[], c: Config): Question[] {
  return qs.filter((q) => getValue(c, q.id) === undefined || c.assumed.includes(q.id));
}

export function fillDefaults(c: Config, qs: Question[]): Config {
  const n: Config = { ...c, models: { ...c.models }, plans: { ...c.plans }, providers: { ...c.providers }, assumed: [...c.assumed] };
  for (const q of qs) {
    if (q.default === null || getValue(c, q.id) !== undefined) continue;
    n[q.id.slice(0, q.id.indexOf(".")) as "models" | "plans" | "providers"][q.id.slice(q.id.indexOf(".") + 1)] = q.default;
    n.assumed.push(q.id);
  }
  return n;
}
