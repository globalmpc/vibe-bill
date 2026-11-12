import { mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { run } from "../src/cli";
import { detect } from "../src/detect/index";
import { collectEnvNames } from "../src/detect/env-names";

const FX = ["next-openai-supabase", "express-anthropic-stack", "no-env-example"];
const tmp = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), "vb-"));
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(d, f, ".."), { recursive: true });
    writeFileSync(join(d, f), c);
  }
  return d;
};
const pkg = (deps: string[]) => JSON.stringify({ dependencies: Object.fromEntries(deps.map((d) => [d, "1"])) });

test.each(FX)("fixture %s matches expected and is deterministic", (n) => {
  const fx = `fixtures/${n}`;
  expect(detect(fx)).toEqual(JSON.parse(readFileSync(`${fx}/expected/detect.json`, "utf8")));
  expect(JSON.stringify(detect(fx))).toBe(JSON.stringify(detect(fx)));
});

test("no-env-example: names from code, REPLICATE only from dotenv", () => {
  const root = "fixtures/no-env-example";
  const code = new Map([["src/llm.js", readFileSync(`${root}/src/llm.js`, "utf8")]]);
  const r = collectEnvNames(root, ["src/llm.js", ".env"], code);
  expect(r.filter((e) => e.source === "code").map((e) => e.name)).toEqual(["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL"]);
  expect(r.filter((e) => e.name === "REPLICATE_API_TOKEN").map((e) => e.source)).toEqual(["dotenv"]);
});

test("walker safety", () => {
  const outside = tmp({ "package.json": pkg(["openai"]) });
  const big = "x".repeat(1024 * 1024 + 1);
  const d = tmp({ "node_modules/openai/package.json": pkg(["openai"]), "big/a.js": 'import "openai";\n//' + big });
  if (process.platform !== "win32") symlinkSync(outside, join(d, "link"));
  expect(detect(d).services).toEqual([]);
  expect(detect(tmp({ "a.js": 'import "openai";\n' })).services.map((s) => s.id)).toEqual(["openai"]);
});

test("CLI writes only detect.json; non-dir fails", () => {
  const d = tmp({ "package.json": pkg(["openai"]) });
  const r = run(["detect", d]);
  expect(r.code).toBe(0);
  expect(readdirSync(d).sort()).toEqual([".vibe-bill", "package.json"]);
  expect(readdirSync(join(d, ".vibe-bill")).sort()).toEqual(["out"]);
  expect(readdirSync(join(d, ".vibe-bill/out"))).toEqual(["detect.json"]);
  const bad = join(d, "package.json");
  expect(run(["detect", bad]).code).toBe(1);
  expect(run(["detect"]).code).toBe(1);
  const e = tmp({});
  expect(run(["detect", join(e, "nope")]).code).toBe(1);
  expect(readdirSync(e)).toEqual([]);
});

test("model rules", () => {
  const a = tmp({ "package.json": pkg(["openai"]), "a.js": 'x({ model: "gpt-4o" }); y({ model: "gpt-4o-mini" })' });
  const s = detect(a).services[0];
  expect(s.model).toBeNull();
  expect(s.model_reason).toBe("multiple models in code: gpt-4o, gpt-4o-mini");
  const b = tmp({ "package.json": pkg(["openai"]), "a.js": 'const m = process.env.OPENAI_MODEL || "gpt-4o-mini"' });
  const r = detect(b);
  expect(r.services[0].model).toBe("gpt-4o-mini");
  expect(r.flags).toEqual([{ type: "model_in_env", env: "OPENAI_MODEL", service: "openai" }]);
});

test("unknowns", () => {
  const d = tmp({
    "package.json": pkg(["replicate", "ai", "express"]),
    "a.js": "process.env.JWT_SECRET; process.env.STRIPE_WEBHOOK_SECRET; process.env.PINECONE_API_KEY; process.env.GITHUB_CLIENT_SECRET; process.env.DISCORD_CLIENT_SECRET; process.env.BETTER_AUTH_SECRET",
  });
  const r = detect(d);
  expect(r.unknown_services).toEqual([{ hint: "env:PINECONE_API_KEY" }, { hint: "package:replicate" }]);
  expect(r.services.map((s) => s.id)).toEqual([]);
});

test("services sorted by id", () => {
  const d = tmp({ "package.json": pkg(["openai", "@anthropic-ai/sdk", "@google/genai"]) });
  expect(detect(d).services.map((s) => s.id)).toEqual(["anthropic", "google", "openai"]);
});
