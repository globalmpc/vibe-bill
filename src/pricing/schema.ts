// Pricing schema + hand-written validation (zero deps).
// Loading choice: this module only validates an already-parsed value. Callers
// `import pricing from "../../data/pricing.json"` (esbuild's json loader inlines it,
// so the bundle is self-contained) or JSON.parse a file in tests, then call loadPricing().
// Stripe-style fee lives on the PLAN: `fee: { percent, fixed_usd }` per transaction.

export const UNITS = [
  "mau", "db_gb", "storage_gb", "egress_gb", "bandwidth_gb", "function_invocations",
  "function_gb_hours", "emails", "image_optimizations", "transactions", "transaction_volume_usd",
] as const;
export type Unit = (typeof UNITS)[number];

export interface Plan {
  base_monthly: number;
  included: Partial<Record<Unit, number>>;
  overage: Partial<Record<Unit, number>> | null;
  fee?: { percent: number; fixed_usd: number };
  /** USD of usage covered by the base fee (Vercel Pro: $20 credit instead of per-unit quotas). */
  usage_credit_usd?: number;
  upgrade_to?: string;
}
export interface Service {
  name: string;
  source_url: string;
  checked_at: string;
  plans: Record<string, Plan>;
  default_plan: string;
  needs_check: boolean;
}
export interface Pricing {
  schema: 1;
  services: Record<string, Service>;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function isValidDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function fail(path: string, msg: string): never {
  throw new Error(`${path}: ${msg}`);
}
function num(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) fail(path, "must be a number >= 0");
  return v;
}
function str(v: unknown, path: string): string {
  if (typeof v !== "string" || v === "") fail(path, "must be a non-empty string");
  return v;
}
function unitMap(v: unknown, path: string): Partial<Record<Unit, number>> {
  if (!isObj(v)) fail(path, "must be an object");
  for (const [k, n] of Object.entries(v)) {
    if (!(UNITS as readonly string[]).includes(k)) fail(`${path}.${k}`, "unknown unit");
    num(n, `${path}.${k}`);
  }
  return v as Partial<Record<Unit, number>>;
}

export function parsePricing(json: unknown): Pricing {
  if (!isObj(json)) fail("pricing", "must be an object");
  if (json.schema !== 1) fail("schema", "must be 1");
  if (!isObj(json.services)) fail("services", "must be an object");
  for (const [id, s] of Object.entries(json.services)) {
    const sp = `services.${id}`;
    if (!isObj(s)) fail(sp, "must be an object");
    str(s.name, `${sp}.name`);
    const url = str(s.source_url, `${sp}.source_url`);
    if (!/^https:\/\/[^\s/]+/.test(url)) fail(`${sp}.source_url`, "must be an https URL");
    if (!isValidDate(s.checked_at)) fail(`${sp}.checked_at`, "must be a valid YYYY-MM-DD date");
    if (typeof s.needs_check !== "boolean") fail(`${sp}.needs_check`, "must be a boolean");
    if (!isObj(s.plans)) fail(`${sp}.plans`, "must be an object");
    const names = Object.keys(s.plans);
    for (const [pn, p] of Object.entries(s.plans)) {
      const pp = `${sp}.plans.${pn}`;
      if (!isObj(p)) fail(pp, "must be an object");
      num(p.base_monthly, `${pp}.base_monthly`);
      unitMap(p.included, `${pp}.included`);
      if (p.overage !== null) unitMap(p.overage, `${pp}.overage`);
      if (p.fee !== undefined) {
        if (!isObj(p.fee)) fail(`${pp}.fee`, "must be an object");
        num(p.fee.percent, `${pp}.fee.percent`);
        num(p.fee.fixed_usd, `${pp}.fee.fixed_usd`);
      }
      if (p.usage_credit_usd !== undefined) num(p.usage_credit_usd, `${pp}.usage_credit_usd`);
      if (p.upgrade_to !== undefined &&!names.includes(p.upgrade_to as string))
        fail(`${pp}.upgrade_to`, "names a plan that does not exist");
    }
    if (typeof s.default_plan !== "string" || !names.includes(s.default_plan))
      fail(`${sp}.default_plan`, "must name an existing plan");
  }
  return json as unknown as Pricing;
}

export const loadPricing = parsePricing;
