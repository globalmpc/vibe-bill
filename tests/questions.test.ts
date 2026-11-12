import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { run } from "../src/cli";
import { detect, type Detect } from "../src/detect/index";
import { loadPricing } from "../src/pricing/schema";
import type { LlmPrices } from "../src/pricing/openrouter";
import { allQuestions, applyAnswers, canonical, emptyConfig, fillDefaults, pendingQuestions, MAX_QUESTIONS } from "../src/questions/index";
import pj from "../data/pricing.json";
import snap from "../data/openrouter-snapshot.json";

const FX = ["next-openai-supabase", "express-anthropic-stack", "no-env-example"];
const P = loadPricing(pj);
const L = { source: "snapshot", fetched_at: snap.fetched_at, models: snap.models } as unknown as LlmPrices;
const rd = (f: string) => readFileSync(f, "utf8");
const tmp = (files: Record<string, string> = {}) => {
  const d = mkdtempSync(join(tmpdir(), "vbq-"));
  for (const [f, c] of Object.entries(files)) { mkdirSync(join(d, f, ".."), { recursive: true }); writeFileSync(join(d, f), c); }
  return d;
};
const app = () => tmp({ "package.json": JSON.stringify({ dependencies: { openai: "1", "@supabase/supabase-js": "1" } }) });
const cfg = (d: string) => join(d, ".vibe-bill", "config.json");
const svc = (id: string, confidence: "high" | "low" = "high") => ({ id, evidence: ["package:" + id], confidence, model: null, model_reason: "no model literal found" });
const CAP: Detect = {
  schema: 1, unknown_services: [], env_names: [],
  services: ["anthropic", "google", "openai", "clerk", "supabase"].map((i) => svc(i)).concat(svc("vercel", "low")),
  flags: [{ type: "base_url", env: "OPENAI_BASE_URL", service: "openai" }],
};

test("fixtures: questions and no-questions config match expected", () => {
  for (const fx of FX) {
    const d = `fixtures/${fx}`;
    expect(JSON.parse(run(["questions", d]).out)).toEqual(JSON.parse(rd(`${d}/expected/questions.json`)));
    expect(canonical(fillDefaults(emptyConfig(), allQuestions(detect(d), P, L)))).toBe(rd(`${d}/expected/config.no-questions.json`));
  }
});

test("plans none: accepted, offered only for low-confidence services", () => {
  const qs = allQuestions(CAP, P, L);
  const opts = (id: string) => qs.find((q) => q.id === id)!.options.map((o) => o.value);
  expect(opts("plans.vercel")).toEqual(["hobby", "pro", "none"]);
  expect(opts("plans.supabase")).toEqual(["free", "pro"]);
  expect(applyAnswers(emptyConfig(), { "plans.vercel": "none" }, P).plans.vercel).toBe("none");
});

test("cap case: order, first 4, <=4 options", () => {
  const qs = allQuestions(CAP, P, L);
  expect(qs.map((q) => q.id)).toEqual(["models.anthropic", "models.google", "models.openai", "providers.OPENAI_BASE_URL", "plans.clerk", "plans.supabase", "plans.vercel"]);
  expect(qs.every((q) => q.options.length <= 4)).toBe(true);
  expect(qs.find((q) => q.id === "models.google")!.default).toBe("~google/gemini-flash-latest");
  expect(pendingQuestions(qs, emptyConfig()).slice(0, MAX_QUESTIONS)).toHaveLength(4);
});

test("saved config gives zero questions; assumed re-pends; new service only adds its own", () => {
  const qs = allQuestions(detect("fixtures/next-openai-supabase"), P, L);
  let c = emptyConfig();
  c = applyAnswers(c, Object.fromEntries(qs.map((q) => [q.id, q.default])), P);
  expect(pendingQuestions(qs, c)).toEqual([]);
  expect(pendingQuestions(qs, fillDefaults(emptyConfig(), qs)).map((q) => q.id)).toEqual(qs.map((q) => q.id));
  const more = allQuestions({ ...detect("fixtures/next-openai-supabase"), services: [...detect("fixtures/next-openai-supabase").services, svc("clerk")] }, P, L);
  expect(pendingQuestions(more, c).map((q) => q.id)).toEqual(["plans.clerk"]);
});

test("applyAnswers merges and clears assumed", () => {
  const c = { ...fillDefaults(emptyConfig(), allQuestions(CAP, P, L)), assumptions: { x: 1 } };
  const n = applyAnswers(c, { "plans.clerk": "pro" }, P);
  expect(n.plans.clerk).toBe("pro");
  expect(n.assumed).not.toContain("plans.clerk");
  expect(n.assumed).toContain("plans.vercel");
  expect(n.models).toEqual(c.models);
  expect(n.assumptions).toEqual({ x: 1 });
});

test("answers validation: exit 1, no value echoed, config untouched", () => {
  const canary = "FAKESECRET_" + "ab12cd34ef56ab78";
  const cases: [string, string][] = [
    ["models.cohere", JSON.stringify({ "models.cohere": "a/b" })],
    ["plans.stripe", JSON.stringify({ "plans.stripe": canary })],
    ["plans.nope", JSON.stringify({ "plans.nope": "pro" })],
    ["badmodel", JSON.stringify({ "models.openai": canary })],
    ["upper", JSON.stringify({ "providers.OPENAI_BASE_URL": "OpenRouter" + canary })],
    ["proto", '{"providers.__proto__":"x"}'],
    ["nonstring", JSON.stringify({ "plans.supabase": 5 })],
    ["array", "[]"],
    ["invalid", `{"a": ${canary}`],
    ["big", JSON.stringify({ "models.openai": "a/" + "x".repeat(70 * 1024) })],
  ];
  for (const [name, body] of cases) {
    const d = app();
    const f = join(d, "answers.json");
    writeFileSync(f, body);
    const r = run(["answer", d, f]);
    expect(r.code, name).toBe(1);
    expect(r.err, name).not.toContain("FAKESECRET");
    expect(readdirSync(d).includes(".vibe-bill"), name).toBe(false);
  }
  const d = app();
  writeFileSync(join(d, ".env.answers"), "{}");
  const r = run(["answer", d, join(d, ".env.answers")]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("env file");
});

test("config errors: exit 1, bytes unchanged", () => {
  for (const body of ["{not json " + "FAKESECRET_x", '{"schema":2}', '{"schema":1,"extra":{}}']) {
    const d = app();
    mkdirSync(join(d, ".vibe-bill"));
    writeFileSync(cfg(d), body);
    const a = join(d, "a.json");
    writeFileSync(a, "{}");
    for (const argv of [["questions", d], ["questions", d, "--no-questions"], ["answer", d, a]]) {
      const r = run(argv);
      expect(r.code).toBe(1);
      expect(r.err).not.toContain("FAKESECRET");
    }
    expect(rd(cfg(d))).toBe(body);
  }
});

test("CLI: questions writes nothing; --no-questions idempotent; answer writes only config", () => {
  const d = app();
  const before = readdirSync(d).sort();
  expect(run(["questions", d]).code).toBe(0);
  expect(readdirSync(d).sort()).toEqual(before);
  const r = run(["questions", d, "--no-questions"]);
  const keys = JSON.parse(r.out).assumed.map((a: { key: string }) => a.key);
  expect(keys).toEqual(["models.openai", "plans.supabase"]);
  const first = rd(cfg(d));
  expect(run(["questions", d, "--no-questions"]).out).toBe(r.out);
  expect(rd(cfg(d))).toBe(first);
  expect(run(["questions", d]).out).toContain('"id": "models.openai"');
  const a = join(tmp(), "answers.json");
  writeFileSync(a, JSON.stringify({ "plans.supabase": "pro" }));
  expect(run(["answer", d, a]).code).toBe(0);
  expect(readdirSync(join(d, ".vibe-bill"))).toEqual(["config.json"]);
  expect(JSON.parse(rd(cfg(d))).plans.supabase).toBe("pro");
  expect(run(["questions", join(d, "package.json")]).code).toBe(1);
  expect(run(["questions"]).code).toBe(1);
  expect(run(["answer", d]).code).toBe(1);
});

test("deterministic and offline", () => {
  const stub = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("network"); });
  const a = run(["questions", "fixtures/no-env-example"]);
  expect(a.code).toBe(0);
  expect(run(["questions", "fixtures/no-env-example"]).out).toBe(a.out);
  expect(stub).not.toHaveBeenCalled();
  stub.mockRestore();
});
