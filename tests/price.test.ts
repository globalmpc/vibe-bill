import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { run } from "../src/cli";
import { renderReceipt, topFix } from "../src/render/index";
import { renderReport } from "../src/render/report";
import { calcBill, resolveAssumptions, parseUsage } from "../src/engine/index";
import { detect } from "../src/detect/index";
import { loadPricing } from "../src/pricing/schema";
import { parseLocal } from "../src/pricing/local";
import { loadPng } from "../src/render/png";
import pricingJson from "../data/pricing.json";
import snap from "../data/openrouter-snapshot.json";
import brand from "../data/brand.json";

const FX = "no-env-example";
const NOW = new Date("2026-11-11T12:00:00Z");
const P = loadPricing(pricingJson);
const rd = (p: string) => readFileSync(p, "utf8");
const exp = (f: string) => join("fixtures", FX, "expected", f);
const INPUT = JSON.parse(rd(exp("price-input.json")));
const ENTRY = INPUT.replicate;

function app(): string {
  const d = mkdtempSync(join(tmpdir(), "vb-price-"));
  cpSync(join("fixtures", FX), d, { recursive: true, filter: (s) => !s.includes(".vibe-bill") && !s.includes("expected") });
  mkdirSync(join(d, ".vibe-bill/out"), { recursive: true });
  cpSync(exp("usage.json"), join(d, ".vibe-bill/out/usage.json"));
  cpSync(exp("config.no-questions.json"), join(d, ".vibe-bill/config.json"));
  return d;
}
const put = (d: string, name: string, v: unknown) => { const f = join(d, name); writeFileSync(f, typeof v === "string" ? v : JSON.stringify(v)); return f; };
const record = (d: string, v: unknown) => run(["price", d, put(d, "in.json", v)], { now: NOW });
const LOCAL = (d: string) => join(d, ".vibe-bill/prices.local.json");
const calcBillJson = (d: string, now = NOW) => { expect(run(["calc", d, "--no-questions"], { now }).code).toBe(0); return JSON.parse(rd(join(d, ".vibe-bill/out/bill.json"))); };

test("AC3 validator rejects bad input, path-only, file untouched", () => {
  const d = app();
  const bad: [string, unknown][] = [
    ["unknown key", { replicate: { ...ENTRY, extra: 1 } }],
    ["unverified present", { replicate: { ...ENTRY, unverified: true } }],
    ["pricing id", { supabase: ENTRY }],
    ["llm id", { openai: ENTRY }],
    ["hint not detected", { replicate: { ...ENTRY, hints: ["env:NOPE_API_KEY"] } }],
    ["hint under two ids", { a: ENTRY, b: ENTRY }],
    ["http url", { replicate: { ...ENTRY, source_url: "http://replicate.com/pricing" } }],
    ["url with space", { replicate: { ...ENTRY, source_url: "https://replicate.com/a b" } }],
    ["url with <", { replicate: { ...ENTRY, source_url: "https://replicate.com/<x" } }],
    ["bad date", { replicate: { ...ENTRY, checked_at: "2026-13-40" } }],
    ["future date", { replicate: { ...ENTRY, checked_at: "2026-11-12" } }],
    ["partial unit", { replicate: { ...ENTRY, unit: null } }],
    ["name slash", { replicate: { ...ENTRY, name: "Rep/licate" } }],
    ["name underscore", { replicate: { ...ENTRY, name: "Rep_licate" } }],
    ["too many", Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`s${i}`, { ...ENTRY, hints: [`env:H${i}_API_KEY`] }]))],
    ["not object", []],
  ];
  for (const [label, v] of bad) {
    const r = record(d, v);
    expect(r.code, label).toBe(1);
    expect(r.err, label).toMatch(/^price: /);
    expect(r.err, label).not.toContain("replicate.com");
    expect(existsSync(LOCAL(d)), label).toBe(false);
  }
  const big = put(d, "big.json", " ".repeat(17 * 1024));
  expect(run(["price", d, big], { now: NOW }).err).toBe("price: entries file too large\n");
  const envx = put(d, ".env.x", INPUT);
  expect(run(["price", d, envx], { now: NOW }).err).toBe("price: refusing to read an env file\n");
  const envReal = put(d, ".env", INPUT);
  symlinkSync(envReal, join(d, "link.json"));
  expect(run(["price", d, join(d, "link.json")], { now: NOW }).err).toBe("price: refusing to read an env file\n");
  expect(existsSync(LOCAL(d))).toBe(false);
});

test("AC3 valid record: forced unverified, canonical, idempotent, merges, existing invalid file is kept", () => {
  const d = app();
  const r = record(d, INPUT);
  expect(r).toEqual({ code: 0, out: "wrote .vibe-bill/prices.local.json\n", err: "" });
  const first = rd(LOCAL(d));
  expect(JSON.parse(first).services.replicate.unverified).toBe(true);
  expect(first.endsWith("}\n")).toBe(true);
  expect(record(d, INPUT).code).toBe(0);
  expect(rd(LOCAL(d))).toBe(first);
  // an unrelated existing entry survives a new record
  const j = JSON.parse(first);
  j.services.other = { ...ENTRY, hints: ["env:OTHER_API_KEY"], name: "Other", unverified: true };
  writeFileSync(LOCAL(d), JSON.stringify(j));
  expect(record(d, INPUT).code).toBe(0);
  expect(Object.keys(JSON.parse(rd(LOCAL(d))).services)).toEqual(["other", "replicate"]);
  // existing invalid file: never overwritten
  writeFileSync(LOCAL(d), "{not json");
  expect(record(d, INPUT).err).toBe("price: prices.local.json: not valid JSON\n");
  expect(rd(LOCAL(d))).toBe("{not json");
});

test("AC2 list mode and 30-day staleness", () => {
  const d = app();
  const list = (now: Date) => JSON.parse(run(["price", d], { now }).out);
  expect(list(NOW)).toEqual({ schema: 1, pending: [{ hint: "env:REPLICATE_API_TOKEN" }], cached: [] });
  record(d, INPUT);
  const l = list(NOW);
  expect(l.pending).toEqual([]);
  expect(l.cached).toEqual([{ id: "replicate", hints: ["env:REPLICATE_API_TOKEN"], checked_at: "2026-11-11", stale: false }]);
  expect(list(new Date("2026-12-11T00:00:00Z")).pending).toEqual([]);
  const s = list(new Date("2026-12-12T00:00:00Z"));
  expect(s.pending).toEqual([{ hint: "env:REPLICATE_API_TOKEN" }]);
  expect(s.cached[0].stale).toBe(true);
});

test("AC4/AC5 engine: unknown lines, totals, assumptions, no-cache equals golden", () => {
  const d = app();
  expect(JSON.stringify(calcBillJson(d), null, 2) + "\n").toBe(rd(exp("bill.json")));
  record(d, INPUT);
  const b = calcBillJson(d);
  const base = JSON.parse(rd(exp("bill.json")));
  b.tiers.forEach((t: { lines: unknown[]; total: number; biggest_line: number; key_assumptions: string[] }, i: number) => {
    expect(t.lines[1]).toEqual({ service: "replicate", label: "Replicate", plan: null, amount: [2, 20, 200, 2000][i], unverified: true });
    expect(t.total).toBeCloseTo([21.305, 213.05, 2130.5, 21305][i], 6);
    expect(t.biggest_line).toBe(0);
    expect(t.key_assumptions).toEqual(base.tiers[i].key_assumptions);
  });
  expect(b.prices_as_of.other_oldest).toBe("2026-11-11");
  // entry whose hint is not detected adds no line
  const e = app();
  writeFileSync(LOCAL(e), JSON.stringify({ schema: 1, services: { gone: { ...ENTRY, hints: ["env:GONE_API_KEY"], unverified: true } } }));
  expect(JSON.stringify(calcBillJson(e), null, 2) + "\n").toBe(rd(exp("bill.json")));
  // all prices null: unpriced
  const f = app();
  record(f, { replicate: { ...ENTRY, base_monthly: null, unit: null, unit_price_usd: null, units_per_user_per_month: null } });
  expect(calcBillJson(f).tiers[2].lines[1]).toEqual({ service: "replicate", label: "Replicate", plan: null, amount: null, unverified: true, unpriced: true });
  // biggest line is the unknown one
  const g = app();
  record(g, { replicate: { ...ENTRY, units_per_user_per_month: 1000 } });
  const bg = calcBillJson(g).tiers[2];
  expect(bg.biggest_line).toBe(1);
  expect(bg.key_assumptions[1]).toBe("Replicate: 1,000 image/user/month");
  // flat plan, biggest: no unit text, no error
  const h = app();
  record(h, { replicate: { ...ENTRY, base_monthly: 5000, unit: null, unit_price_usd: null, units_per_user_per_month: null } });
  expect(calcBillJson(h).tiers[2].key_assumptions[1]).toBe("Replicate: flat plan price, usage not modelled");
});

test("AC4 stale cached entry is flagged", () => {
  const d = app();
  record(d, INPUT);
  const b = calcBillJson(d, new Date("2026-12-20T00:00:00Z"));
  expect(b.tiers[0].lines[1].stale).toBe(true);
  expect(b.prices_as_of.stale).toContain("replicate");
});

test("AC6/AC7 receipt and report for an unknown service", async () => {
  const d = app();
  record(d, INPUT);
  calcBillJson(d);
  const r = run(["render", d], { png: await loadPng(), now: NOW });
  expect(r.code).toBe(0);
  const svg = rd(join(d, ".vibe-bill/out/receipt.svg"));
  const vis = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join("\n");
  expect(vis).toContain("Replicate");
  expect(vis).toContain("(unverified)");
  expect(svg.replace("http://www.w3.org/2000/svg", "")).not.toContain("https://");
  expect(svg).not.toContain("REPLICATE_API_TOKEN");
  expect(svg).not.toContain("env:");
  const rep = rd(join(d, ".vibe-bill/out/report.md"));
  const prices = rep.slice(rep.indexOf("## Prices"), rep.indexOf("## Not modelled"));
  for (const s of ["### Replicate", "<https://replicate.com/pricing>", "checked 2026-11-11", "**unverified**", "$0.004 per image x 5 image/user/month"]) expect(prices).toContain(s);
  expect(rep).not.toContain("Detected but not priced");
  expect(rep).not.toContain("env:REPLICATE_API_TOKEN");
  expect(rep).not.toContain("Lines marked unverified go through a base URL");
});

test("AC7 base-URL sentence still printed for an unverified OpenAI line", () => {
  const d = app();
  const det = detect(d);
  const usage = parseUsage(JSON.parse(rd(exp("usage.json"))), ["openai"]);
  const cfg = JSON.parse(rd(exp("config.no-questions.json")));
  cfg.providers = { OPENAI_BASE_URL: "azure" };
  const bill = calcBill({ detect: det, config: { ...cfg, assumptions: {}, assumed: [] }, usage, assumptions: resolveAssumptions({}, {}), pricing: P, llm: { source: "snapshot", fetched_at: snap.fetched_at, models: snap.models as never }, now: NOW });
  expect(bill.tiers[0].lines[0].unverified).toBe(true);
  const rep = renderReport({ bill, usage, config: cfg, detect: det, pricing: P, snap: { source: "snapshot", fetched_at: snap.fetched_at, models: snap.models as never }, project: "x" });
  expect(rep).toContain("Lines marked unverified go through a base URL");
  expect(rep).toContain("Detected but not priced");
});

test("AC8 render summary and topFix", () => {
  const e = app();
  cpSync(exp("bill.json"), join(e, ".vibe-bill/out/bill.json"));
  const r = run(["render", e]);
  expect(r.out.endsWith("total at 10,000 users: $1,930.50/month\ntop fix: Cache summaries of identical text (saves ~$446/month)\n")).toBe(true);
  expect(run(["render", e, "--tier", "1000"]).out).toContain("total at 1,000 users: ");
  const tier = { users: 10000, lines: [], total: 5, biggest_line: null, key_assumptions: ["a"] };
  const b = { schema: 1, tiers: [tier], traps: [{ id: "public_ai_endpoint_no_rate_limit", call_site: 0, fix: "Add a rate limit", savings_by_tier: null }], prices_as_of: { llm: { source: "snapshot", date: "2026-11-11", stale: false }, other_oldest: null, stale: [], needs_check: [] }, assumptions: {}, assumption_sources: {}, assumed: [] } as never;
  expect(topFix(b, 0)).toEqual({ kind: "risk", fix: "Add a rate limit" });
  expect(renderReceipt(b, 0, "p", brand)).toContain("Top risk: Add a rate limit");
  const n = app();
  const nb = JSON.parse(rd(exp("bill.json")));
  nb.traps[0].call_site = 0;
  nb.traps = [{ ...nb.traps[0], id: "public_ai_endpoint_no_rate_limit", fix: "Add a rate limit", savings_by_tier: null }];
  put(n, ".vibe-bill/out/bill.json", nb);
  expect(run(["render", n]).out.endsWith("top risk: Add a rate limit (abuse cost not estimated)\n")).toBe(true);
});

test("parseLocal rejects foreign file shapes", () => {
  expect(() => parseLocal({ schema: 2, services: {} }, P)).toThrow("schema");
  expect(() => parseLocal({ schema: 1, services: { r: { ...ENTRY } } }, P)).toThrow("unverified");
  expect(parseLocal({ schema: 1 }, P).services).toEqual({});
});
