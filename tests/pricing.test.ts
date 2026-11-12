import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  fetchOpenRouter, getLlmPrices, isStale, loadPricing, pricesAsOf, resolveModel, STALE_AFTER_DAYS,
} from "../src/pricing";

const good = () => ({
  schema: 1,
  services: {
    sb: {
      name: "SB", source_url: "https://x.dev/pricing", checked_at: "2026-11-01", needs_check: false,
      default_plan: "free",
      plans: {
        free: { base_monthly: 0, included: { mau: 5 }, overage: null, upgrade_to: "pro" },
        pro: { base_monthly: 25, included: { mau: 10 }, overage: { mau: 0.1 }, fee: { percent: 2.9, fixed_usd: 0.3 } },
      },
    },
  },
});
const mut = (f: (j: any) => void) => { const j = good(); f(j); return j; };

describe("pricing schema", () => {
  test("valid", () => expect(loadPricing(good()).services.sb.name).toBe("SB"));
  const bad: [string, (j: any) => void, string][] = [
    ["schema", (j) => (j.schema = 2), "schema"],
    ["name", (j) => delete j.services.sb.name, "services.sb.name"],
    ["http url", (j) => (j.services.sb.source_url = "http://x.dev"), "services.sb.source_url"],
    ["bad date", (j) => (j.services.sb.checked_at = "2026-02-30"), "services.sb.checked_at"],
    ["needs_check", (j) => (j.services.sb.needs_check = "no"), "services.sb.needs_check"],
    ["default_plan", (j) => (j.services.sb.default_plan = "nope"), "services.sb.default_plan"],
    ["base_monthly", (j) => (j.services.sb.plans.pro.base_monthly = -1), "plans.pro.base_monthly"],
    ["unit included", (j) => (j.services.sb.plans.pro.included.foo = 1), "services.sb.plans.pro.included.foo: unknown unit"],
    ["unit overage", (j) => (j.services.sb.plans.pro.overage.foo = 1), "overage.foo: unknown unit"],
    ["overage undefined", (j) => delete j.services.sb.plans.pro.overage, "overage"],
    ["fee", (j) => delete j.services.sb.plans.pro.fee.percent, "fee.percent"],
    ["upgrade_to", (j) => (j.services.sb.plans.free.upgrade_to = "gold"), "plans.free.upgrade_to"],
  ];
  test.each(bad)("rejects %s", (_n, f, msg) => expect(() => loadPricing(mut(f))).toThrow(msg));
});

const body = {
  data: [
    { id: "a/x", name: "X", context_length: 1000, pricing: { prompt: "0.0000025", completion: "0.00001" } },
    { id: "a/dyn", name: "Dyn", pricing: { prompt: "-1", completion: "-1" } },
    { id: "a/bad", name: "Bad", pricing: { prompt: "abc", completion: "1" } },
    { id: "a/free", name: "Free", context_length: 5, pricing: { prompt: "0", completion: "0" } },
  ],
};
const ok = (b: unknown) => (async () => new Response(JSON.stringify(b), { status: 200 })) as typeof fetch;
const now = new Date("2026-11-11T12:00:00Z");

describe("openrouter", () => {
  test("converts per-token to per-1M, skips -1 and malformed", async () => {
    const r = await fetchOpenRouter({ fetchImpl: ok(body), now });
    expect(r.source).toBe("openrouter");
    expect(r.fetched_at).toBe("2026-11-11");
    expect(Object.keys(r.models).sort()).toEqual(["a/free", "a/x"]);
    expect(r.models["a/x"]).toEqual({ name: "X", context_length: 1000, input_per_1m: 2.5, output_per_1m: 10 });
  });
  const snapshot = { fetched_at: "2026-01-02", models: { "a/s": { name: "S", context_length: 1, input_per_1m: 1, output_per_1m: 2 } } };
  const cases: [string, typeof fetch][] = [
    ["reject", (async () => { throw new Error("offline"); }) as typeof fetch],
    ["500", (async () => new Response("x", { status: 500 })) as typeof fetch],
    ["garbage", (async () => new Response("not json", { status: 200 })) as typeof fetch],
    ["bad shape", ok({ nope: 1 })],
  ];
  test.each(cases)("falls back to snapshot on %s", async (_n, fetchImpl) => {
    const r = await getLlmPrices({ fetchImpl, snapshot, now });
    expect(r).toMatchObject({ source: "snapshot", fetched_at: "2026-01-02" });
    expect(r.models["a/s"]).toBeDefined();
  });
  test("resolveModel: exact, provider-prefixed, alias, none", async () => {
    const p = await fetchOpenRouter({ fetchImpl: ok(body), now });
    expect(resolveModel(p, null, "a/x")?.id).toBe("a/x");
    expect(resolveModel(p, "a", "x")?.id).toBe("a/x");
    expect(resolveModel(p, "openai", "gpt-4o")).toBeNull();
    expect(resolveModel(p, "a", "xx")).toBeNull();
    const snap = JSON.parse(readFileSync("data/openrouter-snapshot.json", "utf8"));
    expect(resolveModel({ source: "snapshot", ...snap }, null, "gpt-4o")?.id).toBe("openai/gpt-4o");
  });
});

describe("staleness", () => {
  const d = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
  test("boundaries", () => {
    expect(STALE_AFTER_DAYS).toBe(30);
    expect(isStale(d(31), now)).toBe(true);
    expect(isStale(d(30), now)).toBe(false);
    expect(isStale(d(29), now)).toBe(false);
  });
  test("pricesAsOf counts only used services", () => {
    const j: any = good();
    j.services.old = { ...j.services.sb, checked_at: d(40), needs_check: true };
    j.services.sb.checked_at = d(29);
    j.services.mid = { ...j.services.sb, checked_at: d(31) };
    const pricing = loadPricing(j);
    const llm = { source: "snapshot", fetched_at: "2026-10-01" };
    expect(pricesAsOf({ llm, pricing, servicesUsed: ["sb"], now })).toEqual({
      llm: { source: "snapshot", date: "2026-10-01", stale: true }, other_oldest: d(29), stale: [], needs_check: [],
    });
    const r = pricesAsOf({ llm, pricing, servicesUsed: ["sb", "mid", "old"], now });
    expect(r).toMatchObject({ other_oldest: d(40), stale: ["mid", "old"], needs_check: ["old"] });
    expect(pricesAsOf({ llm, pricing, servicesUsed: [], now }).other_oldest).toBeNull();
  });
});

test("snapshot file sanity", () => {
  const s = JSON.parse(readFileSync("data/openrouter-snapshot.json", "utf8"));
  expect(s.schema).toBe(1);
  expect(s.source).toBe("openrouter");
  expect(s.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(Number.isNaN(Date.parse(s.fetched_at))).toBe(false);
  const ids = Object.keys(s.models);
  expect(ids.length).toBeGreaterThan(50);
  for (const m of Object.values<any>(s.models)) {
    expect(Number.isFinite(m.input_per_1m) && m.input_per_1m >= 0).toBe(true);
    expect(Number.isFinite(m.output_per_1m) && m.output_per_1m >= 0).toBe(true);
  }
  for (const p of ["openai/", "anthropic/", "google/"]) expect(ids.some((i) => i.startsWith(p))).toBe(true);
});

describe("data/pricing.json (real file)", () => {
  const real = loadPricing(JSON.parse(readFileSync("data/pricing.json", "utf8")));
  test("covers the five v0.1 services, each with source_url and checked_at", () => {
    expect(Object.keys(real.services).sort()).toEqual(["clerk", "resend", "stripe", "supabase", "vercel"]);
    for (const s of Object.values(real.services)) {
      expect(s.source_url).toMatch(/^https:\/\//);
      expect(s.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  test("usage_credit_usd must be a non-negative number", () => {
    const j = JSON.parse(readFileSync("data/pricing.json", "utf8"));
    j.services.vercel.plans.pro.usage_credit_usd = -1;
    expect(() => loadPricing(j)).toThrow("usage_credit_usd");
  });
});
