// The ONLY module allowed to open real env files (Rule 1). Returns names, never values.
// No logging, no rethrow: every read is swallowed on error.
import { readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";

export type EnvSource = "example" | "code" | "config" | "dotenv";

const BUILTIN = new Set(["NODE_ENV", "MODE", "DEV", "PROD", "SSR", "BASE_URL"]);
const MAX = 1024 * 1024;

export function isEnvFile(rel: string): boolean {
  return /^\.env(\.|$)/.test(basename(rel));
}

/** Refuses a path whose name or realpath is an env file (symlinks included). */
export function assertNotEnvFile(p: string): void {
  let real: string | null = null;
  try { real = realpathSync(p); } catch { /* missing: the caller reports it */ }
  if (isEnvFile(p) || (real !== null && isEnvFile(real))) throw new Error("refusing to read an env file");
}

const CODE_PATTERNS = [
  /process\.env\.(\w+)/g,
  /process\.env\[\s*["'`](\w+)["'`]\s*\]/g,
  /import\.meta\.env\.(\w+)/g,
  /os\.environ\[\s*["'](\w+)["']\s*\]/g,
  /os\.environ\.get\(\s*["'](\w+)["']/g,
  /os\.getenv\(\s*["'](\w+)["']/g,
  /Deno\.env\.get\(\s*["'](\w+)["']/g,
];

function matchAll(text: string, re: RegExp): string[] {
  return [...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))].map((m) => m[1]);
}

const uniq = (a: string[]) => [...new Set(a)].sort();

export function namesFromCode(text: string): string[] {
  return uniq(CODE_PATTERNS.flatMap((re) => matchAll(text, re)).filter((n) => !BUILTIN.has(n)));
}

export function namesFromConfig(rel: string, text: string): string[] {
  const b = basename(rel);
  const out: string[] = [];
  if (/^docker-compose.*\.ya?ml$/.test(b)) {
    for (const re of [/^\s*-\s*([A-Z][A-Z0-9_]*)\s*(?:=|$)/gm, /^\s+([A-Z][A-Z0-9_]*)\s*:/gm, /\$\{([A-Z][A-Z0-9_]*)/g]) out.push(...matchAll(text, re));
  } else if (b === "vercel.json") {
    // no JSON.parse: V8 parse errors quote the input
    for (const blk of text.match(/"env"\s*:\s*\{[^}]*\}/g) ?? []) out.push(...matchAll(blk.replace(/^"env"\s*:/, ""), /"([A-Z][A-Z0-9_]*)"\s*:/g));
  } else if (b === "netlify.toml" || b === "wrangler.toml") {
    out.push(...matchAll(text, /^\s*([A-Z][A-Z0-9_]*)\s*=/gm));
  }
  return uniq(out);
}

// ponytail: uppercase-only names; widen if a real repo shows lowercase env keys.
export function namesFromEnvText(text: string): string[] {
  const out: string[] = [];
  let open = "";
  for (const line of text.split(/\r?\n/)) {
    if (open) {
      if (line.includes(open)) open = "";
      continue;
    }
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) continue;
    out.push(m[1]);
    const v = m[2].trimStart();
    if (/^["'`]/.test(v) && !v.slice(1).includes(v[0])) open = v[0];
  }
  return uniq(out);
}

function safeRead(path: string): string {
  try {
    const t = readFileSync(path, "utf8");
    return t.length > MAX ? "" : t;
  } catch {
    return "";
  }
}

export function collectEnvNames(root: string, files: string[], code: ReadonlyMap<string, string>): { name: string; source: EnvSource }[] {
  const seen = new Map<string, { name: string; source: EnvSource }>();
  const add = (names: string[], source: EnvSource) => names.forEach((name) => seen.set(name + "\0" + source, { name, source }));
  for (const text of code.values()) add(namesFromCode(text), "code");
  for (const rel of files) {
    if (isEnvFile(rel)) add(namesFromEnvText(safeRead(join(root, rel))), /\.(example|sample|template)$/.test(rel) ? "example" : "dotenv");
    else if (/^(docker-compose.*\.ya?ml|vercel\.json|netlify\.toml|wrangler\.toml)$/.test(basename(rel))) add(namesFromConfig(rel, safeRead(join(root, rel))), "config");
  }
  return [...seen.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
}
