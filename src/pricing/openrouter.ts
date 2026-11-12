export interface LlmModel { name: string; context_length: number; input_per_1m: number; output_per_1m: number }
export interface LlmPrices {
  source: "openrouter" | "snapshot";
  fetched_at: string;
  models: Record<string, LlmModel>;
}
export interface FetchOpts { fetchImpl?: typeof fetch; now?: Date; timeoutMs?: number }

const URL = "https://openrouter.ai/api/v1/models";

// USD per token string -> USD per 1M tokens, without float noise. null if unusable.
function per1m(s: unknown): number | null {
  if (typeof s !== "string" || s.trim() === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null; // -1 = dynamic router
  return Number((n * 1e6).toPrecision(12));
}

export function normalizeModels(body: unknown): Record<string, LlmModel> {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new Error("openrouter: missing data array");
  const out: Record<string, LlmModel> = {};
  for (const m of data) {
    if (typeof m?.id !== "string") continue;
    const i = per1m(m.pricing?.prompt);
    const o = per1m(m.pricing?.completion);
    if (i === null || o === null) continue;
    out[m.id] = {
      name: typeof m.name === "string" ? m.name : m.id,
      context_length: Number.isFinite(m.context_length) ? m.context_length : 0,
      input_per_1m: i,
      output_per_1m: o,
    };
  }
  if (Object.keys(out).length === 0) throw new Error("openrouter: no priced models");
  return out;
}

export async function fetchOpenRouter(opts: FetchOpts = {}): Promise<LlmPrices> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(URL, { signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
  if (res.status !== 200) throw new Error(`openrouter: HTTP ${res.status}`);
  const models = normalizeModels(await res.json());
  return { source: "openrouter", fetched_at: (opts.now ?? new Date()).toISOString().slice(0, 10), models };
}

export async function getLlmPrices(
  opts: FetchOpts & { snapshot: { fetched_at: string; models: Record<string, LlmModel> } },
): Promise<LlmPrices> {
  try {
    return await fetchOpenRouter(opts);
  } catch {
    return { source: "snapshot", fetched_at: opts.snapshot.fetched_at, models: opts.snapshot.models };
  }
}

// ponytail: tiny on purpose; add entries only when a real SDK id misses. No fuzzy matching.
export const MODEL_ALIASES: Record<string, string> = {
  "gpt-4o": "openai/gpt-4o",
  "gpt-4o-mini": "openai/gpt-4o-mini",
  "gemini-2.5-pro": "google/gemini-2.5-pro",
  "gemini-2.5-flash": "google/gemini-2.5-flash",
};

export function resolveModel(prices: LlmPrices, provider: string | null, modelId: string): (LlmModel & { id: string }) | null {
  const cands = [modelId, provider ? `${provider}/${modelId}` : "", MODEL_ALIASES[modelId] ?? ""];
  for (const id of cands) {
    if (id && Object.hasOwn(prices.models, id)) return { id, ...prices.models[id] };
  }
  return null;
}
