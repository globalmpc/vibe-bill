import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { run } from "../src/cli";
import { detect, type Detect } from "../src/detect/index";
import { billJson, calcBill, parseUsage, resolveAssumptions } from "../src/engine/index";
import { loadPricing } from "../src/pricing/schema";
import type { LlmPrices } from "../src/pricing/openrouter";
import { emptyConfig, parseConfig, type Config } from "../src/questions/index";
import pj from "../data/pricing.json";
import snap from "../data/openrouter-snapshot.json";
import defaults from "../data/assumptions.default.json";

const P = loadPricing(pj);
const L = { source: "snapshot", fetched_at: snap.fetched_at, models: snap.models } as unknown as LlmPrices;
const NOW = new Date("2026-11-11T00:00:00Z");
const rd = (f: string) => readFileSync(f, "utf8");
const FX = ["next-openai-supabase", "express-anthropic-stack", "no-env-example"];

function fx(name: string, over: Partial<Config> = {}) {
  const d = `fixtures/${name}`;
  const det = detect(d);
  const config = { ...parseConfig(JSON.parse(rd(`${d}/expected/config.no-questions.json`)), P), ...over };
  const usage = parseUsage(JSON.parse(rd(`${d}/expected/usage.json`)), det.services.map((s) => s.id));
  return calcBill({ detect: det, config, usage, assumptions: resolveAssumptions(config.assumptions, usage.per_user), pricing: P, llm: L, now: NOW });
}

test("fixtures: bill.json byte-equal to hand-computed oracle; totals monotonic", () => {
  for (const f of FX) {
    const b = fx(f);
    expect(billJson(b), f).toBe(rd(`fixtures/${f}/expected/bill.json`));
    const t = b.tiers.map((x) => x.total);
    expect([...t].sort((x, y) => x - y)).toEqual(t);
  }
});

test("assumptions file: exactly keys with value + why", () => {
  for (const v of Object.values(defaults) as { value: unknown; why: string }[]) expect(v.why.length).toBeGreaterThan(0);
  expect(Object.keys(defaults)).toHaveLength(26);
});

test("one assumption changes only supabase lines", () => {
  const base = fx("next-openai-supabase");
  const b = fx("next-openai-supabase", { assumptions: { egress_mb_per_active_user_per_day: 10 } });
  expect(b.assumption_sources.egress_mb_per_active_user_per_day).toBe("config");
  let diff = 0;
  b.tiers.forEach((t, i) => t.lines.forEach((l, j) => {
    if (l.service === "supabase") { if (JSON.stringify(l) !== JSON.stringify(base.tiers[i].lines[j])) diff++; }
    else expect(l).toEqual(base.tiers[i].lines[j]);
  }));
  expect(diff).toBeGreaterThan(0);
});

// synthetic helpers
const svc = (id: string) => ({ id, evidence: [], confidence: "high" as const, model: null, model_reason: null });
const det = (...ids: string[]): Detect => ({ schema: 1, services: ids.map(svc), unknown_services: [], flags: [], env_names: [] });
const site = (trigger: string, extra = {}) => ({ service: "openai", feature: "f", trigger, ...extra });
function bill(ids: string[], u: object, cfg: Partial<Config> = {}, now = NOW, d: Detect = det(...ids)) {
  const config = { ...emptyConfig(), models: { openai: "openai/gpt-4o" }, ...cfg };
  const usage = parseUsage({ schema: 1, call_sites: [], traps: [], ...u }, ["openai"]);
  return calcBill({ detect: d, config, usage, assumptions: resolveAssumptions(config.assumptions, usage.per_user), pricing: P, llm: L, now });
}
const T1k = (b: ReturnType<typeof bill>) => b.tiers[1];

test("LLM traps, hand values (N=1000, gpt-4o 800/300 = $0.005/call)", () => {
  const one = (trigger: string, trap?: string, cfg: Partial<Config> = {}) =>
    bill(["openai"], { call_sites: [site(trigger)], traps: trap ? [{ id: trap, call_site: 0, fix: "fix it" }] : [] }, cfg);
  expect(T1k(one("per_message")).lines[0].amount).toBeCloseTo(450, 6);
  const k = one("per_message", "keystroke_llm_call");
  expect(T1k(k).lines[0].amount).toBeCloseTo(18000, 6);
  expect(k.traps[0].savings_by_tier![1]).toBeCloseTo(17550, 6);
  const r = one("per_render", "render_loop_llm_call");
  expect(T1k(r).lines[0].amount).toBeCloseTo(1125, 6);
  expect(r.traps[0].savings_by_tier![1]).toBeCloseTo(900, 6);
  const h = one("per_message", "unbounded_history");
  expect(T1k(h).lines[0].amount).toBeCloseTo(990, 6);
  expect(h.traps[0].savings_by_tier![1]).toBeCloseTo(540, 6);
  const c = one("per_message", "no_prompt_cache");
  expect(T1k(c).lines[0].amount).toBeCloseTo(585, 6);
  expect(c.traps[0].savings_by_tier![1]).toBeCloseTo(135, 6);
  const p = one("per_poll", "aggressive_polling");
  expect(T1k(p).lines[0].amount).toBeCloseTo(10800, 6);
  expect(p.traps[0].savings_by_tier![1]).toBeCloseTo(9900, 6);
  const p60 = one("per_poll", "aggressive_polling", { assumptions: { poll_seconds: 60 } });
  expect(T1k(p60).lines[0].amount).toBeCloseTo(900, 6);
  expect(p60.traps[0].savings_by_tier![1]).toBe(0);
  const pub = one("per_message", "public_ai_endpoint_no_rate_limit");
  expect(pub.traps[0].savings_by_tier).toBeNull();
  expect(T1k(pub).lines[0].traps).toContain("public_ai_endpoint_no_rate_limit");
  const s = bill(["openai"], { call_sites: [site("per_message")], traps: [{ id: "keystroke_llm_call", call_site: 0, fix: "a" }, { id: "no_prompt_cache", call_site: 0, fix: "b" }] });
  expect(T1k(s).lines[0].amount).toBeCloseTo(23400, 6);
  expect(T1k(one("per_message", "top_model_for_trivial_task")).lines[0].amount).toBeCloseTo(450, 6);
});

test("Supabase / Vercel / Stripe hand values", () => {
  const sb = (extra: object, plan = "pro") => bill(["supabase"], { per_user: { storage_mb: 0 }, ...extra }, { plans: { supabase: plan } }).tiers[2].lines[0];
  expect(sb({}).amount).toBeCloseTo(44.5, 6);
  const sel = bill(["supabase"], { per_user: { storage_mb: 0 }, traps: [{ id: "select_all_egress", call_site: null, fix: "x" }] }, { plans: { supabase: "pro" } });
  expect(sel.tiers[2].lines[0].amount).toBeCloseTo(125.5, 6);
  expect(sel.traps[0].savings_by_tier![2]).toBeCloseTo(81, 6);
  const fdb = bill(["supabase"], { traps: [{ id: "files_in_db", call_site: null, fix: "x" }] }, { plans: { supabase: "pro" } });
  expect(fdb.tiers[2].lines[0].amount).toBeCloseTo(69.5, 6);
  expect(fdb.traps[0].savings_by_tier![2]).toBeCloseTo(22.87, 6);
  const free = bill(["supabase"], {}, { plans: { supabase: "free" } }).tiers[1].lines[0];
  expect(free).toMatchObject({ plan: "pro", upgraded_from: "free", amount: 25 });
  expect(bill(["vercel"], {}, { plans: { vercel: "pro" } }).tiers[1].lines[0].amount).toBe(20);
  const img = bill(["vercel"], { traps: [{ id: "image_optimization_on_uploads", call_site: null, fix: "x" }] }, { plans: { vercel: "pro" } });
  expect(img.tiers[2].lines[0].amount).toBeCloseTo(71.77, 6);
  expect(img.traps[0].savings_by_tier![2]).toBeCloseTo(4, 6);
  expect(bill(["vercel"], { traps: [{ id: "image_optimization_on_uploads", call_site: null, fix: "x" }] }, { plans: { vercel: "hobby" } }).tiers[2].lines[0].upgraded_from).toBe("hobby");
  const st = bill(["stripe"], {});
  expect(st.tiers[1].lines[0].amount).toBeCloseTo(29.5, 6);
  expect(st.tiers[0].key_assumptions).toEqual(["100 users/month, 30% active daily", "5% paying, $10 average payment"]);
});

test("unpriced, unverified, none, stale", () => {
  const u = { call_sites: [site("per_message")] };
  const un = bill(["openai", "stripe"], u, { models: { openai: "openai/nope" } });
  expect(un.tiers[1].lines[0]).toMatchObject({ amount: null, unpriced: true });
  expect(un.tiers[1].total).toBeCloseTo(29.5, 6);
  expect(un.tiers[1].biggest_line).toBe(1);
  expect(bill(["openai"], u, { models: { openai: "openai/nope" } }).tiers[1].biggest_line).toBeNull();
  const d: Detect = { ...det("openai"), flags: [{ type: "base_url", env: "OPENAI_BASE_URL", service: "openai" }] };
  expect(bill(["openai"], u, { providers: { OPENAI_BASE_URL: "azure" } }, NOW, d).tiers[1].lines[0].unverified).toBe(true);
  expect(bill(["openai"], u, { providers: { OPENAI_BASE_URL: "openai" } }, NOW, d).tiers[1].lines[0].unverified).toBeUndefined();
  expect(bill(["vercel"], {}, { plans: { vercel: "none" } }).tiers[1].lines).toEqual([]);
  const st = bill(["openai", "vercel"], u, { plans: { vercel: "hobby" } }, new Date("2026-12-13T00:00:00Z"));
  expect(st.prices_as_of.llm.stale).toBe(true);
  expect(st.tiers[0].lines.every((l) => l.stale)).toBe(true);
  expect(st.prices_as_of.stale).toEqual(["vercel"]);
});

test("validators reject with path-only messages", () => {
  const C = "FAKESECRET_ab12";
  const ok = () => ({ schema: 1, call_sites: [{ service: "openai", feature: "chat", trigger: "per_message" }], traps: [] as object[] });
  const bad = (frag: string, mut: (u: any) => void) => {
    const u: any = ok(); mut(u);
    let msg = "";
    try { parseUsage(u, ["openai"]); } catch (e) { msg = (e as Error).message; }
    expect(msg, frag).toContain(frag);
    expect(msg).not.toContain("FAKESECRET");
  };
  bad("unknown key", (u) => { u[C] = 1; });
  bad("usage.schema", (u) => { u.schema = 2; });
  bad("usage.call_sites", (u) => { u.call_sites = {}; });
  bad("usage.call_sites", (u) => { u.call_sites = Array(101).fill(u.call_sites[0]); });
  bad("service", (u) => { u.call_sites[0].service = C; });
  bad("feature", (u) => { u.call_sites[0].feature = "a/" + C; });
  bad("feature", (u) => { u.call_sites[0].feature = "a_" + C; });
  bad("trigger", (u) => { u.call_sites[0].trigger = C; });
  for (const v of [-1, 1.5, 2_000_001]) bad("est_input_tokens", (u) => { u.call_sites[0].est_input_tokens = v; });
  bad("file", (u) => { u.call_sites[0].file = 5; });
  bad("line", (u) => { u.call_sites[0].line = 0; });
  bad("unknown key", (u) => { u.call_sites[0][C] = 1; });
  bad("traps[0].id", (u) => { u.traps = [{ id: C, call_site: 0, fix: "ok" }]; });
  bad("call_site", (u) => { u.traps = [{ id: "keystroke_llm_call", call_site: null, fix: "ok" }]; });
  bad("call_site", (u) => { u.traps = [{ id: "keystroke_llm_call", call_site: 3, fix: "ok" }]; });
  bad("call_site", (u) => { u.traps = [{ id: "files_in_db", call_site: 0, fix: "ok" }]; });
  bad("fix", (u) => { u.traps = [{ id: "keystroke_llm_call", call_site: 0, fix: "see a.ts " + C }]; });
  const t = { id: "keystroke_llm_call", call_site: 0, fix: "ok" };
  bad("duplicate", (u) => { u.traps = [t, t]; });
  bad("per_user", (u) => { u.per_user = { storage_mb: -1 }; });
  bad("per_user", (u) => { u.per_user = { [C]: 1 }; });
  for (const [o, frag] of [[{ [C]: 1 }, "not a known assumption"], [{ tiers: 1 }, "tiers: must be"], [{ tiers: [] }, "tiers: must be"], [{ tiers: [0] }, "tiers: must be"], [{ poll_seconds: C }, "must be a number"], [{ daily_active_ratio: 1.5 }, "out of range"], [{ poll_seconds: 0 }, "out of range"]] as [Record<string, unknown>, string][]) {
    let msg = "";
    try { resolveAssumptions(o, {}); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain(frag);
    expect(msg).not.toContain("FAKESECRET");
  }
});

test("config.assumptions.tiers overrides the user counts (sorted, deduped)", () => {
  const f = fx("next-openai-supabase");
  const det = detect("fixtures/next-openai-supabase");
  const usage = parseUsage(JSON.parse(rd("fixtures/next-openai-supabase/expected/usage.json")), det.services.map((s) => s.id));
  const config = parseConfig(JSON.parse(rd("fixtures/next-openai-supabase/expected/config.no-questions.json")), P);
  const b = calcBill({ detect: det, config, usage, assumptions: resolveAssumptions({ tiers: [1000000, 1000, 1000] }, usage.per_user), pricing: P, llm: L, now: NOW });
  expect(b.tiers.map((t) => t.users)).toEqual([1000, 1000000]);
  expect(b.tiers[1].total).toBeGreaterThan(b.tiers[0].total);
  expect(f.tiers.map((t) => t.users)).toEqual([100, 1000, 10000, 100000]);
});

const tmp = () => mkdtempSync(join(tmpdir(), "vbe-"));
function app(usage: unknown = { schema: 1, call_sites: [{ service: "openai", feature: "chat", file: "a.ts", line: 3, trigger: "per_message" }], traps: [] }) {
  const d = tmp();
  writeFileSync(join(d, "package.json"), JSON.stringify({ dependencies: { openai: "1" } }));
  mkdirSync(join(d, ".vibe-bill/out"), { recursive: true });
  if (usage !== null) writeFileSync(join(d, ".vibe-bill/out/usage.json"), JSON.stringify(usage));
  return d;
}

test("CLI calc: deterministic, offline, writes only config + bill", () => {
  const f = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("network"); });
  const d = app();
  const r = run(["calc", d, "--no-questions"], { now: NOW });
  expect(r).toMatchObject({ code: 0 });
  expect(readdirSync(join(d, ".vibe-bill")).sort()).toEqual(["config.json", "out"]);
  expect(readdirSync(join(d, ".vibe-bill/out")).sort()).toEqual(["bill.json", "usage.json"]);
  const a = rd(join(d, ".vibe-bill/out/bill.json"));
  run(["calc", d, "--no-questions"], { now: NOW });
  expect(rd(join(d, ".vibe-bill/out/bill.json"))).toBe(a);
  expect(a).not.toMatch(/a\.ts|"file"|"line"|"notes"/);
  expect(f).not.toHaveBeenCalled();
  f.mockRestore();
  const live = run(["calc", d], { now: NOW, llm: { source: "openrouter", fetched_at: "2026-11-10", models: L.models } });
  expect(live.code).toBe(0);
  expect(JSON.parse(rd(join(d, ".vibe-bill/out/bill.json"))).prices_as_of.llm.source).toBe("openrouter");
});

test("CLI calc: failures write nothing", () => {
  const none = app(null);
  const r1 = run(["calc", none, "--no-questions"]);
  expect(r1.code).toBe(1);
  expect(readdirSync(join(none, ".vibe-bill/out"))).toEqual([]);
  expect(readdirSync(join(none, ".vibe-bill"))).toEqual(["out"]);
  const pend = app();
  const r2 = run(["calc", pend]);
  expect(r2.code).toBe(1);
  expect(r2.err).toContain("models.openai");
  expect(readdirSync(join(pend, ".vibe-bill"))).toEqual(["out"]);
  expect(readdirSync(join(pend, ".vibe-bill/out"))).toEqual(["usage.json"]);
  const inv = app({ schema: 2 });
  const r3 = run(["calc", inv, "--no-questions"]);
  expect(r3.code).toBe(1);
  expect(readdirSync(join(inv, ".vibe-bill"))).toEqual(["out"]);
});

test("env-file symlinks are refused (usage, answers, config); tmp symlink can't redirect", () => {
  const d = app(null);
  const outside = tmp();
  writeFileSync(join(outside, ".env"), "X=FAKESECRET_" + "0123456789abcdef");
  symlinkSync(join(outside, ".env"), join(d, ".vibe-bill/out/usage.json"));
  const r = run(["calc", d, "--no-questions"]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("env file");
  expect(r.err).not.toContain("FAKESECRET");
  const a = join(d, "answers.json");
  symlinkSync(join(outside, ".env"), a);
  const r2 = run(["answer", d, a]);
  expect(r2.code).toBe(1);
  expect(r2.err).toContain("env file");
  const e = app();
  symlinkSync(join(outside, ".env"), join(e, ".vibe-bill/config.json"));
  expect(run(["calc", e, "--no-questions"]).err).toContain("env file");
  // R1-1
  const g = app();
  const target = join(outside, "victim.txt");
  writeFileSync(target, "keep");
  symlinkSync(target, join(g, ".vibe-bill/config.json.tmp"));
  const ans = join(outside, "answers.json");
  writeFileSync(ans, JSON.stringify({ "models.openai": "openai/gpt-4o" }));
  expect(run(["answer", g, ans]).code).toBe(0);
  expect(rd(target)).toBe("keep");
});

test("config.llm_providers makes a provider with no SDK or env name count as detected", async () => {
  const { run } = await import("../src/cli");
  const d = mkdtempSync(join(tmpdir(), "vbp-"));
  writeFileSync(join(d, "package.json"), '{"dependencies":{"@supabase/supabase-js":"2"}}');
  mkdirSync(join(d, ".vibe-bill/out"), { recursive: true });
  const usage = '{"schema":1,"call_sites":[{"service":"anthropic","feature":"chat","trigger":"per_message"}],"traps":[]}';
  writeFileSync(join(d, ".vibe-bill/out/usage.json"), usage);
  expect(run(["calc", d, "--no-questions"]).err).toContain("not a detected LLM service");
  writeFileSync(join(d, ".vibe-bill/config.json"), '{"schema":1,"llm_providers":["anthropic","anthropic"]}');
  expect(run(["detect", d]).code).toBe(0);
  expect(JSON.parse(rd(join(d, ".vibe-bill/out/detect.json"))).services.map((s: { id: string }) => s.id)).toContain("anthropic");
  const r = run(["calc", d, "--no-questions"]);
  expect(r.err).toBe("");
  expect(JSON.parse(rd(join(d, ".vibe-bill/out/bill.json"))).tiers[2].lines.some((l: { service: string }) => l.service === "anthropic")).toBe(true);
  writeFileSync(join(d, ".vibe-bill/config.json"), '{"schema":1,"llm_providers":["nope"]}');
  expect(run(["calc", d, "--no-questions"]).err).toContain("llm_providers[0]");
});
