import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { assertNotEnvFile } from "../detect/env-names";
import type { Pricing } from "../pricing/schema";

// Trust boundary: answers.json and config.json are untrusted. Errors carry field paths only, never values.
export type Config = {
  schema: 1;
  models: Record<string, string>;
  plans: Record<string, string>;
  providers: Record<string, string>;
  assumptions: Record<string, unknown>;
  assumed: string[];
  /** LLM providers the user declared because the code can't show them (proxy, gateway, CLI). */
  llm_providers: string[];
};
export const LLM_NAMES: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", google: "Google AI", openrouter: "OpenRouter" };

const SECTIONS = ["models", "plans", "providers"] as const;
const TOP = ["schema", "models", "plans", "providers", "assumptions", "assumed", "llm_providers"];
const KEY = /^(models|plans|providers)\.[A-Za-z0-9_]{1,64}$/;
const ASSUMED = /^(models|plans|providers|assumptions)\.[A-Za-z0-9_]{1,64}$/;
const MODEL = /^~?[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9._:~-]{1,100}$/;
const ENV = /^[A-Z][A-Z0-9_]{0,63}$/;
const PROV = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const MAX_CONFIG = 256 * 1024;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (m: string): never => { throw new Error(m); };
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const emptyConfig = (): Config => ({ schema: 1, models: {}, plans: {}, providers: {}, assumptions: {}, assumed: [], llm_providers: [] });

/** id must already match KEY. Throws path-only errors. */
export function checkEntry(id: string, value: unknown, pricing: Pricing, where: "answers" | "config"): void {
  const dot = id.indexOf(".");
  const sec = id.slice(0, dot), name = id.slice(dot + 1), p = `${where}.${id}`;
  if (sec === "models") { if (!Object.hasOwn(LLM_NAMES, name)) fail(`${p}: unknown service`); }
  else if (sec === "plans") { if (!Object.hasOwn(pricing.services, name)) fail(`${p}: unknown service`); }
  else if (!ENV.test(name)) fail(`${p}: not an env var name`);
  if (typeof value !== "string") fail(`${p}: must be a string`);
  const v = value as string;
  if (sec === "models") { if (!MODEL.test(v)) fail(`${p}: must be a model id like provider/model`); }
  else if (sec === "plans") { if (v !== "none" && !Object.hasOwn(pricing.services[name].plans, v)) fail(`${p}: unknown plan`); }
  else if (!PROV.test(v)) fail(`${p}: must be a lowercase provider id`);
}

export function parseConfig(json: unknown, pricing: Pricing): Config {
  if (!isObj(json)) return fail("config: must be an object");
  for (const k of Object.keys(json)) if (!TOP.includes(k)) fail("config: unknown top-level key");
  if (json.schema !== 1) fail("config.schema: must be 1");
  const c = emptyConfig();
  for (const sec of SECTIONS) {
    const m = json[sec];
    if (m === undefined) continue;
    if (!isObj(m)) fail(`config.${sec}: must be an object`);
    const out: Record<string, string> = {};
    Object.keys(m as object).sort(cmp).forEach((k, i) => {
      const id = sec + "." + k;
      if (!KEY.test(id)) fail(`config.${sec}: key #${i} is not valid`);
      checkEntry(id, (m as Record<string, unknown>)[k], pricing, "config");
      out[k] = (m as Record<string, string>)[k];
    });
    c[sec] = out;
  }
  if (json.assumptions !== undefined) {
    if (!isObj(json.assumptions)) fail("config.assumptions: must be an object");
    c.assumptions = Object.fromEntries(Object.entries(json.assumptions as object).sort((a, b) => cmp(a[0], b[0])));
  }
  if (json.llm_providers !== undefined) {
    const l = json.llm_providers;
    if (!Array.isArray(l) || l.length > Object.keys(LLM_NAMES).length) fail("config.llm_providers: must be an array of provider ids");
    (l as unknown[]).forEach((a, i) => { if (typeof a !== "string" || !Object.hasOwn(LLM_NAMES, a)) fail(`config.llm_providers[${i}]: must be one of ${Object.keys(LLM_NAMES).join(", ")}`); });
    c.llm_providers = [...new Set(l as string[])].sort(cmp);
  }
  if (json.assumed !== undefined) {
    if (!Array.isArray(json.assumed)) fail("config.assumed: must be an array");
    (json.assumed as unknown[]).forEach((a, i) => {
      if (typeof a !== "string" || !ASSUMED.test(a)) fail(`config.assumed[${i}]: not a config key`);
    });
    c.assumed = [...new Set(json.assumed as string[])].sort(cmp);
  }
  return c;
}

const cfgPath = (root: string) => join(root, ".vibe-bill", "config.json");

export function readConfig(root: string, pricing: Pricing): Config {
  const p = cfgPath(root);
  if (!existsSync(p)) return emptyConfig();
  assertNotEnvFile(p);
  if (statSync(p).size > MAX_CONFIG) fail("config.json: too large");
  let j: unknown;
  try { j = JSON.parse(readFileSync(p, "utf8")); } catch { return fail("config.json: not valid JSON"); }
  return parseConfig(j, pricing);
}

export function canonical(c: Config): string {
  const sorted = (m: Record<string, unknown>) => Object.fromEntries(Object.entries(m).sort((a, b) => cmp(a[0], b[0])));
  return JSON.stringify({
    schema: 1, models: sorted(c.models), plans: sorted(c.plans), providers: sorted(c.providers),
    assumptions: sorted(c.assumptions), assumed: [...new Set(c.assumed)].sort(cmp),
    ...(c.llm_providers.length ? { llm_providers: [...new Set(c.llm_providers)].sort(cmp) } : {}), // omitted when empty so existing configs stay byte-equal
  }, null, 2) + "\n";
}

/** Refuses symlinked dirs from p up to .vibe-bill, so a cloned repo can't redirect writes outside the project. */
function assertNoSymlinkDirs(p: string): void {
  for (let d = dirname(p); ; d = dirname(d)) {
    if (existsSync(d) && lstatSync(d).isSymbolicLink()) fail(`refusing to write through symlinked directory: ${basename(d)}`);
    if (basename(d) === ".vibe-bill" || dirname(d) === d) return;
  }
}

/** Per-process tmp name (concurrent runs don't clobber each other); removed first and opened with wx, so a planted symlink can't redirect the write. */
export function writeAtomic(p: string, data: string | Uint8Array): void {
  assertNoSymlinkDirs(p);
  const tmp = `${p}.${process.pid}.tmp`;
  rmSync(tmp, { force: true });
  try {
    writeFileSync(tmp, data, { flag: "wx" });
    renameSync(tmp, p);
  } catch (e) { rmSync(tmp, { force: true }); throw e; }
}

export function writeConfig(root: string, c: Config): void {
  mkdirSync(join(root, ".vibe-bill"), { recursive: true });
  writeAtomic(cfgPath(root), canonical(c));
}

export function getValue(c: Config, id: string): string | undefined {
  const dot = id.indexOf(".");
  const sec = id.slice(0, dot), k = id.slice(dot + 1);
  if (!(SECTIONS as readonly string[]).includes(sec)) return undefined;
  const m = c[sec as (typeof SECTIONS)[number]];
  return Object.hasOwn(m, k) ? m[k] : undefined;
}

export function applyAnswers(c: Config, answers: unknown, pricing: Pricing): Config {
  if (!isObj(answers)) return fail("answers: must be an object");
  const keys = Object.keys(answers);
  if (keys.length > 50) fail("answers: must be an object");
  keys.forEach((k, i) => { if (!KEY.test(k)) fail(`answers: key #${i} is not a question id`); });
  for (const k of keys) checkEntry(k, answers[k], pricing, "answers");
  const n: Config = { ...c, models: { ...c.models }, plans: { ...c.plans }, providers: { ...c.providers }, assumed: [...c.assumed] };
  for (const k of keys) {
    const dot = k.indexOf(".");
    n[k.slice(0, dot) as (typeof SECTIONS)[number]][k.slice(dot + 1)] = answers[k] as string;
    n.assumed = n.assumed.filter((a) => a !== k);
  }
  return n;
}
