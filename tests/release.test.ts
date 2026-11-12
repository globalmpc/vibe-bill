import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { run } from "../src/cli";
import { loadPng } from "../src/render/png";

const rd = (p: string) => readFileSync(p, "utf8");
const readme = rd("README.md");

test("AC1 README sections in order", () => {
  const heads = ["# vibe-bill", "## Install", "## Use it", "## Is it safe?", "## What it checks", "## Good to know", "## Change the guesses", "## Contributing", "## License"];
  const at = heads.map((h) => readme.indexOf(h));
  expect(at.every((i) => i >= 0), String(at)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  expect(readme.startsWith("![Example receipt")).toBe(true);
  expect(readme).toContain("Discounts from caching or batch pricing are not included, so your real bill may be lower.");
  expect(rd("LICENSE")).toContain("MIT License");
});

test("AC2 README commands, flags, paths and assumption keys exist", () => {
  const unknown = run(["nope"]).err;
  const cmds = new Set<string>();
  const docs = readme + rd("CONTRIBUTING.md");
  for (const m of docs.matchAll(/vibe-bill\.mjs\s+(\w+)/g)) cmds.add(m[1]);
  for (const m of docs.matchAll(/`(detect|questions|answer|calc|price|render)\b[^`]*`/g)) cmds.add(m[1]);
  expect(cmds.size).toBeGreaterThan(2);
  for (const c of cmds) expect(run([c]).err, c).not.toBe(unknown);
  const cli = rd("src/cli.ts");
  for (const f of new Set(readme.match(/(?<=\s|`)--[a-z][a-z-]*/g))) if (f !== "--exclude-dir") expect(cli, f).toContain(f);
  for (const m of readme.matchAll(/`((?:data|src|skills|docs|fixtures|scripts|tests)\/[\w./-]+?)`/g)) {
    const p = m[1].replace(/\/$/, "");
    if (p.includes("*")) continue;
    expect(existsSync(p), p).toBe(true);
  }
  const keys = JSON.parse(rd("data/assumptions.default.json"));
  const used = [...readme.matchAll(/"assumptions":\s*\{\s*"(\w+)"/g)].map((m) => m[1]);
  expect(used.length).toBeGreaterThan(0);
  for (const k of used) expect(Object.keys(keys), k).toContain(k);
});

test("AC4 notices name files that ship", () => {
  const n = rd("THIRD_PARTY_NOTICES.md");
  const files = [...n.matchAll(/`(skills\/vibe-bill\/scripts\/[^`]+)`/g)].map((m) => m[1]);
  expect(files.length).toBeGreaterThanOrEqual(4);
  for (const f of files) expect(existsSync(f), f).toBe(true);
});

test("AC8 committed example SVG equals a fresh render of the fixture", async () => {
  const fx = "next-openai-supabase";
  const d = join(mkdtempSync(join(tmpdir(), "vb-rel-")), fx);
  cpSync(`fixtures/${fx}`, d, { recursive: true, filter: (s) => !s.includes(".vibe-bill") && !s.includes("expected") });
  mkdirSync(join(d, ".vibe-bill/out"), { recursive: true });
  cpSync(`fixtures/${fx}/expected/usage.json`, join(d, ".vibe-bill/out/usage.json"));
  const now = new Date("2026-11-11T12:00:00Z");
  for (const a of [["detect", d], ["calc", d, "--no-questions"]]) expect(run(a, { now }).code).toBe(0);
  const r = run(["render", d], { png: await loadPng(), now });
  expect(r.code).toBe(0);
  expect(rd(join(d, ".vibe-bill/out/receipt.svg"))).toBe(rd("docs/img/example-receipt.svg"));
  expect(existsSync("docs/img/example-receipt.png")).toBe(true);
}, 60000);
