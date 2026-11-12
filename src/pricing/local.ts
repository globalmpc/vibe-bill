// Trust boundary: prices.local.json (user-owned) and the `price` input (written by the skill after a web search) are untrusted.
// Errors carry field paths and entry indexes only, never values or ids. D-045.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { assertNotEnvFile } from "../detect/env-names";
import { LLM_NAMES } from "../questions/config";
import type { Pricing } from "./schema";
import { isStale } from "./staleness";

export type LocalEntry = {
  hints: string[]; name: string; source_url: string; checked_at: string;
  base_monthly: number | null; unit: string | null; unit_price_usd: number | null; units_per_user_per_month: number | null;
  unverified: true;
};
export type Local = { schema: 1; services: Record<string, LocalEntry> };

export const MAX_LOCAL = 64 * 1024, MAX_INPUT = 16 * 1024, MAX_ENTRIES = 50, MAX_RECORD = 10;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HINT = /^(env|package):[A-Za-z0-9@/._-]{1,100}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 &+-]{0,29}$/;
const URL_RE = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]*)?$/;
const UNIT = /^[a-z0-9][a-z0-9 ]{0,23}$/;
const KEYS = ["hints", "name", "source_url", "checked_at", "base_monthly", "unit", "unit_price_usd", "units_per_user_per_month"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const fail = (m: string): never => { throw new Error(m); };
const realDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

export const emptyLocal = (): Local => ({ schema: 1, services: {} });

function entry(e: unknown, p: string, input: boolean, hintsOk: string[] | null, now: Date | null, pricing: Pricing, id: string): LocalEntry {
  if (!ID.test(id) || Object.hasOwn(pricing.services, id) || Object.hasOwn(LLM_NAMES, id)) fail(`${p}: invalid id`);
  if (!isObj(e)) return fail(`${p}: must be an object`);
  Object.keys(e).forEach((k, i) => { if (!KEYS.includes(k) && !(k === "unverified" && !input)) fail(`${p}: ${k === "unverified" ? "unverified not allowed" : `unknown key #${i}`}`); });
  if (!input && e.unverified !== true) fail(`${p}.unverified: must be true`);
  const h = e.hints;
  if (!Array.isArray(h) || h.length < 1 || h.length > 5 || !h.every((x) => typeof x === "string" && HINT.test(x))) fail(`${p}.hints: invalid`);
  if (hintsOk && !(h as string[]).every((x) => hintsOk.includes(x))) fail(`${p}.hints: not a detected unknown service`);
  if (typeof e.name !== "string" || !NAME.test(e.name)) fail(`${p}.name: invalid`);
  if (typeof e.source_url !== "string" || e.source_url.length > 300 || !URL_RE.test(e.source_url)) fail(`${p}.source_url: invalid`);
  if (typeof e.checked_at !== "string" || !realDate(e.checked_at)) fail(`${p}.checked_at: invalid`);
  if (now && (e.checked_at as string) > now.toISOString().slice(0, 10)) fail(`${p}.checked_at: in the future`);
  const n = (k: string, max: number): number | null => {
    const v = e[k] ?? null;
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max)) fail(`${p}.${k}: invalid`);
    return v as number | null;
  };
  const base = n("base_monthly", 1e6), price = n("unit_price_usd", 1e4), per = n("units_per_user_per_month", 1e6);
  const unit = e.unit ?? null;
  if (unit !== null && (typeof unit !== "string" || !UNIT.test(unit))) fail(`${p}.unit: invalid`);
  if (new Set([unit === null, price === null, per === null]).size !== 1) fail(`${p}: unit, unit_price_usd and units_per_user_per_month must be all set or all null`);
  return {
    hints: [...new Set(h as string[])].sort(cmp), name: e.name as string, source_url: e.source_url as string, checked_at: e.checked_at as string,
    base_monthly: base, unit: unit as string | null, unit_price_usd: price, units_per_user_per_month: per, unverified: true,
  };
}

function noDupHints(s: Record<string, LocalEntry>, where: string) {
  const seen = new Set<string>();
  for (const id of Object.keys(s)) for (const h of s[id].hints) { if (seen.has(h)) fail(`${where}: a hint is under two ids`); seen.add(h); }
}

export function parseLocal(json: unknown, pricing: Pricing): Local {
  const w = "prices.local.json";
  if (!isObj(json)) return fail(`${w}: must be an object`);
  if (Object.keys(json).some((k) => k !== "schema" && k !== "services")) fail(`${w}: unknown top-level key`);
  if (json.schema !== 1) fail(`${w}.schema: must be 1`);
  const sv = json.services ?? {};
  if (!isObj(sv)) return fail(`${w}.services: must be an object`);
  const ids = Object.keys(sv).sort(cmp);
  if (ids.length > MAX_ENTRIES) fail(`${w}.services: too many entries`);
  const services: Record<string, LocalEntry> = {};
  ids.forEach((id, i) => { services[id] = entry(sv[id], `${w}.services[#${i}]`, false, null, null, pricing, id); });
  noDupHints(services, `${w}.services`);
  return { schema: 1, services };
}

/** The `price` input: { id: entry-without-unverified }. All-or-nothing. */
export function parseEntries(json: unknown, unknownHints: string[], now: Date, pricing: Pricing): Record<string, LocalEntry> {
  if (!isObj(json)) return fail("entries: must be an object");
  const ids = Object.keys(json);
  if (ids.length < 1 || ids.length > MAX_RECORD) fail("entries: must have 1..10 entries");
  const out: Record<string, LocalEntry> = {};
  ids.forEach((id, i) => { out[id] = entry(json[id], `entries[#${i}]`, true, unknownHints, now, pricing, id); });
  noDupHints(out, "entries");
  return out;
}

export function readLocal(root: string, pricing: Pricing): Local {
  const p = join(root, ".vibe-bill", "prices.local.json");
  if (!existsSync(p)) return emptyLocal();
  assertNotEnvFile(p);
  if (statSync(p).size > MAX_LOCAL) fail("prices.local.json: too large");
  let j: unknown;
  try { j = JSON.parse(readFileSync(p, "utf8")); } catch { return fail("prices.local.json: not valid JSON"); }
  return parseLocal(j, pricing);
}

export function mergeLocal(cur: Local, add: Record<string, LocalEntry>): Local {
  const services = { ...cur.services, ...add };
  if (Object.keys(services).length > MAX_ENTRIES) fail("prices.local.json.services: too many entries");
  noDupHints(services, "prices.local.json.services");
  return { schema: 1, services };
}

export function canonicalLocal(l: Local): string {
  const services = Object.fromEntries(Object.keys(l.services).sort(cmp).map((id) => {
    const e = l.services[id];
    return [id, Object.fromEntries(Object.keys(e).sort(cmp).map((k) => [k, (e as Record<string, unknown>)[k]]))];
  }));
  return JSON.stringify({ schema: 1, services }, null, 2) + "\n";
}

/** Entries that cover at least one currently detected unknown service, sorted by id. */
export function usedEntries(l: Local, unknownHints: string[]): [string, LocalEntry][] {
  return Object.keys(l.services).sort(cmp).filter((id) => l.services[id].hints.some((h) => unknownHints.includes(h))).map((id) => [id, l.services[id]]);
}

export function listLocal(l: Local, unknownHints: string[], now: Date) {
  const fresh = new Set(Object.values(l.services).filter((e) => !isStale(e.checked_at, now)).flatMap((e) => e.hints));
  return {
    schema: 1,
    pending: unknownHints.filter((h) => !fresh.has(h)).map((hint) => ({ hint })),
    cached: Object.keys(l.services).sort(cmp).map((id) => ({ id, hints: l.services[id].hints, checked_at: l.services[id].checked_at, stale: isStale(l.services[id].checked_at, now) })),
  };
}
