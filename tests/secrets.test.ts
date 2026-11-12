import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { run } from "../src/cli";
import { loadPng } from "../src/render/png";

const PREFIX = "FAKESECRET_";
let captured: string[] = [];
beforeEach(() => {
  captured = [];
  const cap = (...a: unknown[]) => { captured.push(a.map(String).join(" ")); return true; };
  vi.spyOn(console, "log").mockImplementation(cap);
  vi.spyOn(console, "error").mockImplementation(cap);
  vi.spyOn(console, "warn").mockImplementation(cap);
  vi.spyOn(process.stdout, "write").mockImplementation(((c: unknown) => cap(c)) as never);
  vi.spyOn(process.stderr, "write").mockImplementation(((c: unknown) => cap(c)) as never);
});
afterEach(() => vi.restoreAllMocks());

const count = (text: string, needle: string) => text.split(needle).length - 1;
const filesUnder = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(d, e.name)) : [join(d, e.name)]));

// failure messages carry only file + count, never matched text
function expectClean(label: string, text: string, needles: string[]) {
  const n = needles.reduce((s, x) => s + count(text, x), 0);
  expect(n, `${label}: ${n} secret match(es)`).toBe(0);
}

test("(a) fixtures: prefix absent from outputs, logs and bundle", () => {
  for (const fx of ["next-openai-supabase", "express-anthropic-stack", "no-env-example"]) {
    const r = run(["detect", `fixtures/${fx}`]);
    const q = run(["questions", `fixtures/${fx}`]);
    expectClean(`${fx} cli`, r.out + r.err + q.out + q.err, [PREFIX]);
    expectClean(`${fx} bill`, readFileSync(`fixtures/${fx}/expected/bill.json`, "utf8"), [PREFIX]);
    for (const f of filesUnder(`fixtures/${fx}/.vibe-bill/out`)) expectClean(`${fx} out file`, readFileSync(f, "utf8"), [PREFIX]);
  }
  expectClean("captured logs", captured.join("\n"), [PREFIX]);
});

test("(a2) fixtures: render outputs are clean", async () => {
  const png = await loadPng();
  for (const fx of ["next-openai-supabase", "express-anthropic-stack", "no-env-example"]) {
    const d = mkdtempSync(join(tmpdir(), "vb-rfx-"));
    cpSync(`fixtures/${fx}`, d, { recursive: true, filter: (s) => !s.includes(".vibe-bill") && !s.includes("expected") });
    mkdirSync(join(d, ".vibe-bill/out"), { recursive: true });
    for (const [f, to] of [["bill.json", ".vibe-bill/out/bill.json"], ["usage.json", ".vibe-bill/out/usage.json"], ["config.no-questions.json", ".vibe-bill/config.json"]]) cpSync(`fixtures/${fx}/expected/${f}`, join(d, to));
    const r = run(["render", d], { png });
    expect(r.code).toBe(0);
    expectClean(`${fx} render stdio`, r.out + r.err, [PREFIX]);
    for (const f of filesUnder(join(d, ".vibe-bill/out"))) expectClean(`${fx} render file`, readFileSync(f, "latin1"), [PREFIX]);
  }
  for (const f of readdirSync("skills/vibe-bill/scripts")) expectClean(`bundle ${f}`, readFileSync(join("skills/vibe-bill/scripts", f), "latin1"), [PREFIX]);
});

test("(b) canary: generated secrets never appear in any output", async () => {
  const d = mkdtempSync(join(tmpdir(), "vb-canary-"));
  const v = () => PREFIX + randomBytes(8).toString("hex");
  const vals = Array.from({ length: 8 }, v);
  const [a, b, c, p, e, comp, vj, w] = vals;
  const put = (f: string, t: string) => writeFileSync(join(d, f), t);
  put(".env", `export A_KEY=${a}\nQ="${b}=x"\nPEM="-----BEGIN\nABCDEF=${p}\n-----END"\n`);
  put(".env.local", `LOCAL_ONE=${c}\n`);
  put(".env.example", `EXAMPLE_ONE=${e}\n`);
  put("docker-compose.yml", `services:\n  app:\n    environment:\n      - COMPOSE_ONE=${comp}\n`);
  put("vercel.json", `{"env":{"VERCEL_ONE":"${vj}"}}`);
  put("wrangler.toml", `[vars]\nWRANGLER_ONE = "${w}"\n`);
  const r = run(["detect", d]);
  expect(r.code).toBe(0);
  const out = readFileSync(join(d, ".vibe-bill/out/detect.json"), "utf8");
  const needles = [PREFIX, ...vals, ...vals.map((x) => x.slice(PREFIX.length))];
  expectClean("canary out", out + r.out + r.err + captured.join("\n"), needles);
  const names = JSON.parse(out).env_names;
  expect(names).toEqual(expect.arrayContaining(["A_KEY", "Q", "PEM", "LOCAL_ONE", "EXAMPLE_ONE", "COMPOSE_ONE", "VERCEL_ONE", "WRANGLER_ONE"]));
  expect(names).not.toContain("ABCDEF");
  put("package.json", JSON.stringify({ dependencies: { openai: "1" } }));
  mkdirSync(join(d, ".vibe-bill/out"), { recursive: true });
  put(".vibe-bill/out/usage.json", JSON.stringify({ schema: 1, call_sites: [{ service: "openai", feature: "chat", file: "a.ts", line: 1, trigger: "per_message", notes: "x" }], traps: [] }));
  const cr = run(["calc", d, "--no-questions"]);
  expect(cr.code).toBe(0);
  const bill = readFileSync(join(d, ".vibe-bill/out/bill.json"), "utf8") + readFileSync(join(d, ".vibe-bill/config.json"), "utf8");
  expectClean("canary calc", bill + cr.out + cr.err + captured.join("\n"), needles);
  expect(bill).not.toContain("a.ts");
  const png = await loadPng();
  put(".vibe-bill/out/usage.json", JSON.stringify({ schema: 1, call_sites: [{ service: "openai", feature: "chat", file: "a.ts", line: 1, trigger: "per_message", notes: vals[0] }], traps: [] }));
  const rr = run(["render", d], { png, now: new Date("2026-11-11T00:00:00Z") });
  expect(rr.code).toBe(0);
  for (const f of ["receipt.svg", "receipt.png", "receipt.html", "report.md"]) expectClean(`canary ${f}`, readFileSync(join(d, ".vibe-bill/out", f), "latin1"), needles);
  expectClean("canary render stdio", rr.out + rr.err + captured.join("\n"), needles);
  const rep = readFileSync(join(d, ".vibe-bill/out/report.md"), "utf8");
  for (const n of ["A_KEY", "LOCAL_ONE"]) expect(readFileSync(join(d, ".vibe-bill/out/receipt.svg"), "utf8")).not.toContain(n);
  expect(rep).toContain("`a.ts:1`");
});

test("(c) static guard: only env-names.ts touches .env literals and never logs", () => {
  for (const f of filesUnder("src")) {
    const t = readFileSync(f, "utf8");
    if (f.endsWith("env-names.ts")) expectClean(f, t, ["console.", "process.stdout", "process.stderr"]);
    else expect(count(t, "\".env") + count(t, "'.env") + count(t, "`.env"), `${f}: .env literal`).toBe(0);
  }
});

test("(d) e2e + price flow: every generated file, incl. prices.local.json, is clean", async () => {
  const png = await loadPng();
  const NOW = new Date("2026-11-11T12:00:00Z");
  const d = join(mkdtempSync(join(tmpdir(), "vb-sec-")), "no-env-example");
  cpSync("fixtures/no-env-example", d, { recursive: true, filter: (s) => !s.includes(".vibe-bill") && !s.includes("expected") });
  mkdirSync(join(d, ".vibe-bill/out"), { recursive: true });
  cpSync("fixtures/no-env-example/expected/usage.json", join(d, ".vibe-bill/out/usage.json"));
  const std: string[] = [];
  const go = (a: string[], o: { png?: typeof png; now?: Date } = { now: NOW }) => { const r = run(a, o); std.push(r.out, r.err); expect(r.code, a[0]).toBe(0); };
  go(["detect", d]);
  go(["questions", d]);
  cpSync("fixtures/no-env-example/expected/price-input.json", join(d, ".vibe-bill/out/price-input.json"));
  go(["price", d]);
  go(["price", d, join(d, ".vibe-bill/out/price-input.json")]);
  writeFileSync(join(d, ".vibe-bill/out/answers.json"), "{}");
  go(["answer", d, join(d, ".vibe-bill/out/answers.json")]);
  go(["calc", d, "--no-questions"]);
  go(["render", d], { png, now: NOW });
  for (const f of filesUnder(join(d, ".vibe-bill"))) expectClean(`sec e2e file`, readFileSync(f, "latin1"), [PREFIX]);
  expectClean("sec e2e stdio", std.join("\n") + captured.join("\n"), [PREFIX]);
});

test("(e) canary: a secret-looking price input is rejected without echo or file", () => {
  const d = mkdtempSync(join(tmpdir(), "vb-canary-price-"));
  const v = PREFIX + randomBytes(8).toString("hex");
  writeFileSync(join(d, "package.json"), JSON.stringify({ dependencies: { replicate: "1" } }));
  const entry = { hints: ["package:replicate"], name: "Rep", source_url: "https://x.example/p", checked_at: "2026-11-11", base_monthly: 1, unit: null, unit_price_usd: null, units_per_user_per_month: null };
  const needles = [PREFIX, v, v.slice(PREFIX.length)];
  for (const bad of [{ ...entry, name: v }, { ...entry, source_url: `https://x.example/${v}?a b` }, { ...entry, unit: v }]) {
    writeFileSync(join(d, "in.json"), JSON.stringify({ rep: bad }));
    const r = run(["price", d, join(d, "in.json")], { now: new Date("2026-11-11T12:00:00Z") });
    expect(r.code).toBe(1);
    expectClean("price canary", r.out + r.err + captured.join("\n"), needles);
  }
  expect(existsSync(join(d, ".vibe-bill/prices.local.json"))).toBe(false);
});

test("(f) README, CONTRIBUTING, notices and docs/img contain no secret prefix", () => {
  for (const f of ["README.md", "CONTRIBUTING.md", "THIRD_PARTY_NOTICES.md", ...filesUnder("docs/img")]) expectClean(f, readFileSync(f, "latin1"), [PREFIX]);
});
