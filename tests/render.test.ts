import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { run } from "../src/cli";
import type { Bill } from "../src/engine/index";
import { TRAPS } from "../src/engine/usage";
import { approx, defaultTier, money, parseBill, renderHtml, renderReceipt, projectName } from "../src/render/index";
import { CATALOGUE, renderReport } from "../src/render/report";
import { loadPng } from "../src/render/png";
import { loadPricing } from "../src/pricing/schema";
import pricingJson from "../data/pricing.json";
import snap from "../data/openrouter-snapshot.json";
import brand from "../data/brand.json";

const FX = ["next-openai-supabase", "express-anthropic-stack", "no-env-example"];
const UPDATE = process.env.UPDATE_GOLDEN === "1";
const rd = (p: string) => readFileSync(p, "utf8");
const exp = (fx: string, f: string) => join("fixtures", fx, "expected", f);
const bill = (fx: string) => parseBill(JSON.parse(rd(exp(fx, "bill.json"))));
const NOW = new Date("2026-11-11T12:00:00Z");
const visible = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
const inOrder = (hay: string[], needles: string[]) => {
  let at = 0;
  for (const n of needles) { const k = hay.findIndex((h, i) => i >= at && h.includes(n)); expect(k, `missing/out of order: ${n}`).toBeGreaterThanOrEqual(0); at = k + 1; }
};

function app(fx: string, usageOver?: object): string {
  const d = mkdtempSync(join(tmpdir(), "vb-render-"));
  const out = join(d, ".vibe-bill", "out");
  mkdirSync(out, { recursive: true });
  cpSync(join("fixtures", fx), d, { recursive: true, filter: (s) => !s.includes(".vibe-bill") && !s.includes("expected") });
  writeFileSync(join(out, "bill.json"), rd(exp(fx, "bill.json")));
  writeFileSync(join(out, "usage.json"), usageOver ? JSON.stringify(usageOver) : rd(exp(fx, "usage.json")));
  cpSync(exp(fx, "config.no-questions.json"), join(d, ".vibe-bill", "config.json"));
  return d;
}

const small = (over: Partial<Bill["tiers"][0]> = {}, traps: Bill["traps"] = []): Bill => ({
  schema: 1,
  tiers: [{ users: 10000, lines: [{ service: "openai", label: "OpenAI: x", plan: "openai/gpt-4o", amount: 5 }], total: 5, biggest_line: 0, key_assumptions: ["a"], ...over }],
  traps, prices_as_of: { llm: { source: "snapshot", date: "2026-11-11", stale: false }, other_oldest: null, stale: [], needs_check: [] },
  assumptions: {}, assumption_sources: {}, assumed: [],
});

test("AC6 money and approx", () => {
  expect([0, 0.004, 0.005, 44.5, 89.37, 112633.87, 1126325.2, null].map(money)).toEqual(["$0.00", "<$0.01", "$0.01", "$44.50", "$89.37", "$112,633.87", "$1,126,325.20", "n/a"]);
  expect([109708.56, 3078, 0.4].map(approx)).toEqual(["~$109,709", "~$3,078", "<$1"]);
});

test("AC1 SVG byte-identical, equals golden; no clocks/locale in src/render", () => {
  for (const fx of FX) {
    const b = bill(fx);
    const svg = renderReceipt(b, defaultTier(b), fx, brand);
    expect(renderReceipt(b, defaultTier(b), fx, brand)).toBe(svg);
    if (UPDATE) writeFileSync(exp(fx, "receipt.svg"), svg);
    expect(svg).toBe(rd(exp(fx, "receipt.svg")));
  }
  for (const f of readdirSync("src/render")) {
    const t = rd(join("src/render", f));
    for (const bad of ["Date(", "Math.random", "toLocaleString", "Intl.", "fetch", "http://", "https://"]) {
      if (f === "report.ts" && bad === "https://") continue;
      if (f !== "png.ts" && (bad === "fetch" || bad === "http://")) continue;
      if (f === "index.ts" && bad === "http://") continue;
      expect(t.includes(bad), `${f}: ${bad}`).toBe(false);
    }
  }
});

test("AC2 hand-checked receipt text", () => {
  const b = bill("next-openai-supabase");
  const svg = renderReceipt(b, 2, "next-openai-supabase", brand);
  const v = visible(svg);
  inOrder(v, ["VIBE BILL — next-openai-supabase", "ESTIMATE", "@ 10,000 users / month", "OpenAI: chat reply", "$112,500.00", "openai/gpt-4o", "Vercel", "$89.37", "pro (upgraded from hobby)", "Supabase", "$44.50", "pro (upgraded from free)", "TOTAL", "$112,633.87", "Top fix: Call the API", "Assumes:", "LLM prices: OpenRouter snapshot 2026-11-11", "github.com/globalmpc/vibe-bill", 'search "vibe-bill" on GitHub']);
  const joined = v.join(" ");
  expect(joined).toContain("Call the API on submit or debounce typing by 500 ms");
  expect(joined).toContain("saves ~$109,709/month");
  expect(joined).toContain("Other prices checked 2026-11-11");
  for (const k of b.tiers[2].key_assumptions) for (const w of k.split(" ")) expect(joined).toContain(w);
  expect(svg.match(/<path /g)).toHaveLength(1);
  const ex = renderReceipt(bill("express-anthropic-stack"), 2, "x", brand);
  expect(visible(ex).join(" ")).toContain("$4,320.00");
  expect(visible(ex).join(" ")).toContain("Top fix: Use a Haiku-class model for ticket replies → saves ~$3,078/month");
  const ne = visible(renderReceipt(bill("no-env-example"), 2, "x", brand)).join(" ");
  expect(ne).not.toContain("Other prices checked");
  expect(ne).toContain("$1,930.50");
});

test("AC3 rule 8: receipt has no path/line/notes/env names; report has file:line only", () => {
  const u = JSON.parse(rd(exp("next-openai-supabase", "usage.json")));
  u.call_sites[0].file = "app/secret/route.ts"; u.call_sites[0].line = 4242; u.call_sites[0].notes = "FAKESECRET_abc123";
  const d = app("next-openai-supabase", u);
  const r = run(["render", d]);
  expect(r.code).toBe(0);
  const o = join(d, ".vibe-bill/out");
  for (const f of ["receipt.svg", "receipt.html"]) {
    const t = rd(join(o, f));
    for (const n of ["route.ts", "app/secret", "4242", "FAKESECRET_", "OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) expect(t.includes(n), `${f}: ${n}`).toBe(false);
  }
  const rep = rd(join(o, "report.md"));
  expect(rep).toContain("`app/secret/route.ts:4242`");
  expect(rep).not.toContain("FAKESECRET_");
});

test("AC4 marks", () => {
  const b = small({ lines: [
    { service: "a", label: "A", plan: "p", amount: 1, stale: true },
    { service: "b", label: "B", plan: "p", amount: 2, unverified: true },
    { service: "c", label: "C", plan: null, amount: null, unpriced: true },
  ] });
  b.prices_as_of.llm.stale = true; b.prices_as_of.other_oldest = "2026-01-01"; b.prices_as_of.stale = ["a"];
  const v = visible(renderReceipt(b, 0, "p", brand)).join(" ");
  for (const s of ["(price may be outdated)", "(unverified)", "n/a", "(no price found)", "(excludes 1 unpriced line)", "(may be outdated)", "(some may be outdated)"]) expect(v).toContain(s);
  expect(renderReceipt(b, 0, "p", brand)).not.toContain("<path");
});

test("AC5 escaping", () => {
  const label = `A & <b> "q" 'x'`;
  const b = small({ lines: [{ service: "openai", label, plan: "p", amount: 1, traps: ["no_prompt_cache"] }] });
  const svg = renderReceipt(b, 0, "p", brand);
  expect(svg).toContain("A &amp; &lt;b&gt; &quot;q&quot; &#39;x&#39;");
  expect(svg).not.toContain("<b>");
  expect(svg.match(/<text/g)!.length).toBe(svg.match(/<\/text>/g)!.length);
  expect(svg.replace(/>[^<]*<\/text>/g, "></text>")).not.toContain("A &amp;");
  const rep = renderReport({ bill: b, usage: { schema: 1, call_sites: [], traps: [], per_user: {} }, config: { schema: 1, models: {}, plans: {}, providers: {}, assumptions: {}, assumed: [], llm_providers: [] }, detect: { schema: 1, services: [], unknown_services: [], flags: [], env_names: [] }, pricing: loadPricing(pricingJson), snap: { source: "snapshot", fetched_at: snap.fetched_at, models: snap.models as never }, project: "p" });
  expect(rep).toContain("A & \\<b\\>".replace("&", "&"));
  const withPipe = small({ lines: [{ service: "x", label: "a|b", plan: "p", amount: 1 }] });
  expect(renderReport({ bill: withPipe, usage: { schema: 1, call_sites: [], traps: [], per_user: {} }, config: { schema: 1, models: {}, plans: {}, providers: {}, assumptions: {}, assumed: [], llm_providers: [] }, detect: { schema: 1, services: [], unknown_services: [], flags: [], env_names: [] }, pricing: loadPricing(pricingJson), snap: { source: "snapshot", fetched_at: snap.fetched_at, models: snap.models as never }, project: "p" })).toContain("a\\|b");
});

test("AC7 layout limits", () => {
  const long = small({ lines: [{ service: "google", label: "Google AI: " + "x".repeat(40), plan: "p", amount: 1234.5 }] });
  const svg = renderReceipt(long, 0, "p", brand);
  expect(visible(svg).some((s) => s.startsWith("Google AI: ") && s.endsWith("..."))).toBe(true);
  expect(visible(svg)).toContain("$1,234.50");
  for (const m of svg.matchAll(/<text[^>]*font-size="(\d+)"[^>]*>([^<]*)<\/text>/g)) {
    const s = visible(m[0])[0];
    expect(s.length, s).toBeLessThanOrEqual(m[1] === "20" ? 44 : 54);
  }
  const many = small({ lines: Array.from({ length: 10 }, (_, i) => ({ service: "s" + i, label: "L" + i, plan: "p", amount: i + 1 })) });
  const v = visible(renderReceipt(many, 0, "p", brand));
  expect(v).toContain("Other (3 lines)");
  expect(v).toContain("$6.00");
  expect(v.filter((s) => /^L\d$/.test(s))).toHaveLength(7);
  const h = Number(svg.match(/height="(\d+)"/)![1]);
  const lastY = Math.max(...[...svg.matchAll(/<text[^>]* y="(\d+)"/g)].map((m) => Number(m[1])));
  expect(h).toBe(lastY + 32);
  expect(svg).toContain('width="600"');
});

test("AC8/AC9 CLI tier and I/O", () => {
  const d = app("next-openai-supabase");
  const o = join(d, ".vibe-bill/out");
  const before = readdirSync(o).sort();
  for (const a of [["--tier", "5000"], ["--tier", "10k"], ["--tier"]]) {
    const r = run(["render", d, ...a]);
    expect(r).toEqual({ code: 1, out: "", err: "render: --tier must be one of 100, 1000, 10000, 100000\n" });
  }
  expect(readdirSync(o).sort()).toEqual(before);
  const r = run(["render", d, "--tier", "1000"]);
  expect(r.code).toBe(0);
  expect(r.err).toContain("receipt.png skipped");
  expect(r.out.startsWith("wrote .vibe-bill/out/receipt.svg\nwrote .vibe-bill/out/receipt.html\nwrote .vibe-bill/out/report.md\ntotal at 1,000 users: $11,295.00/month\ntop fix: ")).toBe(true);
  const svg = rd(join(o, "receipt.svg"));
  expect(visible(svg)).toContain("@ 1,000 users / month");
  expect(visible(svg).join(" ")).toContain("$11,295.00");
  expect(rd(join(o, "receipt.html"))).not.toContain("receipt.png");
  run(["render", d]);
  expect(visible(rd(join(o, "receipt.svg")))).toContain("@ 10,000 users / month");

  const e = app("no-env-example");
  const eo = join(e, ".vibe-bill/out");
  writeFileSync(join(eo, "bill.json"), rd(exp("no-env-example", "bill.json")).replace('"total": 1930.5', '"total": "x"'));
  const bad = run(["render", e]);
  expect(bad.code).toBe(1);
  expect(bad.err).toMatch(/^render: bill\.json\.tiers\[\d\]\.total: invalid/);
  expect(bad.err).not.toContain('"x"');
  expect(existsSync(join(eo, "receipt.svg"))).toBe(false);
  const f = app("no-env-example");
  writeFileSync(join(f, ".vibe-bill/out/bill.json").replace("bill", "bill"), rd(exp("no-env-example", "bill.json")));
  expect(run(["render", app("no-env-example")]).code).toBe(0);
  const g = mkdtempSync(join(tmpdir(), "vb-empty-"));
  expect(run(["render", g]).err).toBe("render: bill.json not found (run calc first)\n");
  mkdirSync(join(g, ".vibe-bill/out"), { recursive: true });
  writeFileSync(join(g, ".vibe-bill/out/bill.json"), rd(exp("no-env-example", "bill.json")));
  expect(run(["render", g]).err).toBe("render: usage.json not found (run the analysis first)\n");
  expect(existsSync(join(g, ".vibe-bill/out/receipt.svg"))).toBe(false);
  expect(run([]).err).toContain("render <path> [--tier N]");
});

test("AC11 HTML", () => {
  const svg = renderReceipt(bill("no-env-example"), 2, "x", brand);
  const h = renderHtml(svg, true);
  expect(h).toContain(svg);
  expect(h).toContain('<a href="receipt.png" download>');
  const rest = h.replace(svg, "");
  for (const bad of ["<script", "<link", "<img", "url(", "src=", "http://", "https://"]) expect(rest.includes(bad), bad).toBe(false);
  expect(svg.match(/https?:\/\/[^"]*/g)).toEqual(["http://www.w3.org/2000/svg"]);
});

test("AC12 report goldens, headings, content", () => {
  const verdicts: Record<string, string> = { "next-openai-supabase": "**High bill risk.**", "express-anthropic-stack": "**Medium bill risk.**", "no-env-example": "**Medium bill risk.**" };
  const heads = ["# vibe-bill report: ", "## Verdict", "## Bill by tier", "## Cost traps", "## Assumptions", "## Prices", "## Not modelled", "## What this estimate can't know", "## Technical notes"];
  for (const fx of FX) {
    const mk = () => renderReport({
      bill: bill(fx), usage: JSON.parse(rd(exp(fx, "usage.json"))), config: JSON.parse(rd(exp(fx, "config.no-questions.json"))), detect: JSON.parse(rd(exp(fx, "detect.json"))),
      pricing: loadPricing(pricingJson), snap: { source: "snapshot", fetched_at: snap.fetched_at, models: snap.models as never }, project: fx,
    });
    const r = mk();
    expect(mk()).toBe(r);
    if (UPDATE) writeFileSync(exp(fx, "report.md"), r);
    expect(r).toBe(rd(exp(fx, "report.md")));
    let at = -1;
    for (const h of heads) { const k = r.indexOf("\n" + h); const k2 = h.startsWith("# ") ? r.indexOf(h) : k; expect(k2, h).toBeGreaterThan(at); at = k2; }
    expect(r).toContain(verdicts[fx]);
    expect(r).toContain("> LLM prices are OpenRouter list rates; direct-API discounts such as prompt caching or batch pricing are not included, so the actual bill may be lower.");
    expect(r).toContain("```text");
  }
  const r = rd(exp("next-openai-supabase", "report.md"));
  expect(r).toContain("$112,633.87");
  expect(r).toMatch(/\| storage\\_mb\\_per\\_user \| 0 \| code analysis \|/);
  expect(r).toContain("| models.openai | openai/gpt-4o | assumed |");
  expect(r).toContain("https://supabase.com/pricing");
  expect(r).toMatch(/supabase.com\/pricing, checked [0-9-]+ \*\*needs check\*\*/);
  expect(r).toContain("`app/api/chat/route.ts:8`");
  expect(r).not.toContain("called from the chat input");
  const nm = r.slice(r.indexOf("## Not modelled"), r.indexOf("## What this"));
  expect(nm).toContain("Supabase");
  expect(nm).toContain("Vercel");
  expect(nm).not.toContain("Stripe");
  expect(r.indexOf("Call the API on submit")).toBeLessThan(r.indexOf("Require sign-in"));
  expect(Object.keys(CATALOGUE).sort()).toEqual([...TRAPS].sort());
});

test("project name sanitising", () => {
  expect(projectName("/x/my<app>")).toBe("myapp");
  expect(projectName("/x/<>")).toBe("my app");
});

test("AC10 PNG smoke, deterministic", async () => {
  const png = await loadPng();
  const d = app("next-openai-supabase");
  const r = run(["render", d], { png, now: NOW });
  expect(r.code).toBe(0);
  expect(r.err).toBe("");
  const f = join(d, ".vibe-bill/out/receipt.png");
  const buf = readFileSync(f);
  expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const svgH = Number(rd(join(d, ".vibe-bill/out/receipt.svg")).match(/height="(\d+)"/)![1]);
  expect(buf.readUInt32BE(16)).toBe(1200);
  expect(buf.readUInt32BE(20)).toBe(2 * svgH);
  expect(rd(join(d, ".vibe-bill/out/receipt.html"))).toContain('<a href="receipt.png" download>');
  run(["render", d], { png });
  expect(Buffer.compare(buf, readFileSync(f))).toBe(0);
});

test("AC10 bundle: scripts dir assets and child-process render", async () => {
  const { execFileSync } = await import("node:child_process");
  const dir = "skills/vibe-bill/scripts";
  expect(readdirSync(dir).sort()).toEqual(["LICENSE-LiberationMono.txt", "LiberationMono-Regular.ttf", "resvg-wasm.LICENSE.txt", "resvg.wasm", "vibe-bill.mjs"].sort());
  const d = app("express-anthropic-stack");
  const out = execFileSync("node", [join(dir, "vibe-bill.mjs"), "render", d], { encoding: "utf8" });
  expect(out).toContain("wrote .vibe-bill/out/receipt.png");
  expect(statSync(join(d, ".vibe-bill/out/receipt.png")).size).toBeGreaterThan(1000);
}, 30000);
