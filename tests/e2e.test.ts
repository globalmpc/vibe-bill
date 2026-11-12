import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { run } from "../src/cli";
import { TRAPS, TRIGGERS } from "../src/engine/usage";
import { loadPng } from "../src/render/png";

const FX = ["next-openai-supabase", "express-anthropic-stack", "no-env-example"];
const NOW = new Date("2026-11-11T12:00:00Z");
const rd = (p: string) => readFileSync(p, "utf8");
const exp = (fx: string, f: string) => join("fixtures", fx, "expected", f);

/** Copies the app into <tmp>/<fixture-name> (so the project name matches the golden) with usage.json as the skill's analysis would leave it. */
function copy(fx: string): string {
  const d = join(mkdtempSync(join(tmpdir(), "vb-e2e-")), fx);
  cpSync(join("fixtures", fx), d, { recursive: true, filter: (s) => !s.includes(".vibe-bill") && !s.includes("expected") });
  mkdirSync(join(d, ".vibe-bill/out"), { recursive: true });
  cpSync(exp(fx, "usage.json"), join(d, ".vibe-bill/out/usage.json"));
  return d;
}
const out = (d: string, f: string) => rd(join(d, ".vibe-bill/out", f));
const ok = (r: { code: number; err: string }, label: string) => expect(r.code, `${label}: ${r.err}`).toBe(0);

test("AC9 unattended sequence per fixture reproduces the goldens", async () => {
  const png = await loadPng();
  for (const fx of FX) {
    const d = copy(fx);
    ok(run(["detect", d]), "detect");
    ok(run(["questions", d]), "questions");
    ok(run(["calc", d, "--no-questions"], { now: NOW }), "calc");
    ok(run(["render", d], { png, now: NOW }), "render");
    expect(out(d, "bill.json"), fx).toBe(rd(exp(fx, "bill.json")));
    expect(rd(join(d, ".vibe-bill/config.json")), fx).toBe(rd(exp(fx, "config.no-questions.json")));
    expect(out(d, "receipt.svg"), fx).toBe(rd(exp(fx, "receipt.svg")));
    expect(out(d, "report.md"), fx).toBe(rd(exp(fx, "report.md")));
    expect(existsSync(join(d, ".vibe-bill/out/receipt.png")), fx).toBe(true);
  }
}, 60000);

test("AC9 attended variant: answers with each default", async () => {
  const d = copy("express-anthropic-stack");
  ok(run(["detect", d]), "detect");
  const qs = JSON.parse(run(["questions", d]).out).questions as { id: string; default: string | null }[];
  expect(qs.length).toBeGreaterThan(0);
  const answers = Object.fromEntries(qs.filter((q) => q.default !== null).map((q) => [q.id, q.default]));
  writeFileSync(join(d, ".vibe-bill/out/answers.json"), JSON.stringify(answers));
  ok(run(["answer", d, join(d, ".vibe-bill/out/answers.json")]), "answer");
  ok(run(["calc", d, "--no-questions"], { now: NOW }), "calc");
  ok(run(["render", d], { png: await loadPng(), now: NOW }), "render");
  const cfg = JSON.parse(rd(join(d, ".vibe-bill/config.json")));
  for (const id of Object.keys(answers)) expect(cfg.assumed, id).not.toContain(id);
});

test("AC9 bundle variant: real child process", () => {
  const bundle = resolve("skills/vibe-bill/scripts/vibe-bill.mjs");
  const d = copy("no-env-example");
  const cwd = mkdtempSync(join(tmpdir(), "vb-cwd-"));
  for (const a of [["detect", d], ["questions", d], ["calc", d, "--no-questions"], ["render", d]]) {
    const r = spawnSync(process.execPath, [bundle, ...a], { cwd, encoding: "utf8" });
    expect(r.status, `${a[0]}: ${r.stderr}`).toBe(0);
  }
  expect(existsSync(join(d, ".vibe-bill/out/receipt.png"))).toBe(true);
  const p = spawnSync(process.execPath, [bundle, "price", d], { cwd, encoding: "utf8" });
  expect(JSON.parse(p.stdout).pending).toEqual([{ hint: "env:REPLICATE_API_TOKEN" }]);
}, 60000);

test("AC10 second run reuses the cached price, outputs byte-identical", async () => {
  const png = await loadPng();
  const d = copy("no-env-example");
  const files = [join(d, ".vibe-bill/prices.local.json"), ...["bill.json", "receipt.svg", "report.md"].map((f) => join(d, ".vibe-bill/out", f))];
  ok(run(["detect", d]), "detect");
  expect(JSON.parse(run(["price", d], { now: NOW }).out).pending).toHaveLength(1);
  ok(run(["price", d, exp("no-env-example", "price-input.json")], { now: NOW }), "record");
  ok(run(["calc", d, "--no-questions"], { now: NOW }), "calc");
  ok(run(["render", d], { png, now: NOW }), "render");
  const first = files.map(rd);
  expect(first[1]).toContain('"service": "replicate"');
  expect(first[3]).toContain("<https://replicate.com/pricing>");

  ok(run(["detect", d]), "detect 2");
  expect(JSON.parse(run(["price", d], { now: NOW }).out).pending).toEqual([]);
  ok(run(["calc", d, "--no-questions"], { now: NOW }), "calc 2");
  ok(run(["render", d], { png, now: NOW }), "render 2");
  expect(files.map(rd)).toEqual(first);
}, 60000);

test("AC1 SKILL.md contract", () => {
  const s = rd("skills/vibe-bill/SKILL.md");
  const fm = s.split("---")[1];
  expect(fm).toContain("name: vibe-bill\n");
  expect(fm).toContain('argument-hint: "[path] [--no-questions]"');
  expect(fm).toContain("allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/vibe-bill.mjs *)");
  for (const id of [...TRIGGERS, ...TRAPS]) expect(s, id).toContain(id);
  for (const t of ["${CLAUDE_SKILL_DIR}/scripts/vibe-bill.mjs", "--no-questions", "calc P --no-questions", "price P", "AskUserQuestion", "pending", ".env.example"]) expect(s, t).toContain(t);
  // every CLI invocation uses the exact form, and plain `calc` is never shown
  for (const m of s.matchAll(/vibe-bill\.mjs\s+calc\b[^\n`]*/g)) expect(m[0]).toContain("--no-questions");
  const headings = [...s.matchAll(/^## (\d)\./gm)].map((m) => m[1]).join("");
  expect(headings).toBe("0123456".slice(0, headings.length));
  expect(headings.length).toBe(7);
  expect(s.split("\n").length).toBeLessThan(220);
});
