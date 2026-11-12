// Trust boundary: usage.json is written by the skill's analysis (an LLM reading user code) and may be hand-edited.
// Errors carry paths only, never values or unknown key names. file/line/notes are validated but never leave usage.json.
export const TRIGGERS = ["per_message", "per_page_view", "per_keystroke", "per_render", "per_poll", "per_cron_run", "per_webhook", "per_signup"] as const;
export const TRAPS = [
  "keystroke_llm_call", "render_loop_llm_call", "unbounded_history", "top_model_for_trivial_task", "no_prompt_cache",
  "public_ai_endpoint_no_rate_limit", "aggressive_polling", "image_optimization_on_uploads", "select_all_egress", "files_in_db",
] as const;
export const APP_WIDE_TRAPS: readonly string[] = ["image_optimization_on_uploads", "select_all_egress", "files_in_db"];

export type Trigger = (typeof TRIGGERS)[number];
export type TrapId = (typeof TRAPS)[number];
export type CallSite = {
  service: string; feature: string; file: string | null; line: number | null; trigger: Trigger;
  est_input_tokens: number | null; est_output_tokens: number | null; notes: string | null;
};
export type Trap = { id: TrapId; call_site: number | null; fix: string };
export type Usage = { schema: 1; call_sites: CallSite[]; traps: Trap[]; per_user: { emails_per_month?: number; storage_mb?: number } };

const FEATURE = /^[A-Za-z0-9][A-Za-z0-9 ,'()&+-]{0,39}$/;
const FIX = /^[A-Za-z0-9][A-Za-z0-9 ,;:'()&+%-]{0,99}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (m: string): never => { throw new Error(m); };
const unset = (v: unknown) => v === undefined || v === null;
const int = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

function keys(o: Record<string, unknown>, allowed: string[], path: string) {
  Object.keys(o).forEach((k, i) => { if (!allowed.includes(k)) fail(`${path}: unknown key #${i}`); });
}

export function parseUsage(json: unknown, llmServices: string[]): Usage {
  if (!isObj(json)) return fail("usage: must be an object");
  keys(json, ["schema", "call_sites", "traps", "per_user"], "usage");
  if (json.schema !== 1) fail("usage.schema: must be 1");
  if (!Array.isArray(json.call_sites) || json.call_sites.length > 100) fail("usage.call_sites: must be an array of at most 100");
  const trapsIn = json.traps ?? [];
  if (!Array.isArray(trapsIn) || trapsIn.length > 100) fail("usage.traps: must be an array of at most 100");

  const call_sites = (json.call_sites as unknown[]).map((c, i): CallSite => {
    const p = `usage.call_sites[${i}]`;
    if (!isObj(c)) return fail(`${p}: must be an object`);
    keys(c, ["service", "feature", "file", "line", "trigger", "est_input_tokens", "est_output_tokens", "notes"], p);
    if (typeof c.service !== "string" || !llmServices.includes(c.service)) fail(`${p}.service: not a detected LLM service`);
    if (typeof c.feature !== "string" || !FEATURE.test(c.feature)) fail(`${p}.feature: invalid`);
    if (typeof c.trigger !== "string" || !(TRIGGERS as readonly string[]).includes(c.trigger)) fail(`${p}.trigger: unknown trigger`);
    for (const k of ["est_input_tokens", "est_output_tokens"]) if (!unset(c[k]) && !int(c[k], 0, 2_000_000)) fail(`${p}.${k}: must be an integer 0..2000000`);
    if (!unset(c.file) && (typeof c.file !== "string" || c.file.length > 300)) fail(`${p}.file: must be a string up to 300 characters`);
    if (!unset(c.line) && !int(c.line, 1, 10_000_000)) fail(`${p}.line: must be an integer 1..10000000`);
    if (!unset(c.notes) && (typeof c.notes !== "string" || c.notes.length > 500)) fail(`${p}.notes: must be a string up to 500 characters`);
    return {
      service: c.service as string, feature: c.feature as string, file: (c.file as string) ?? null, line: (c.line as number) ?? null,
      trigger: c.trigger as Trigger, est_input_tokens: (c.est_input_tokens as number) ?? null,
      est_output_tokens: (c.est_output_tokens as number) ?? null, notes: (c.notes as string) ?? null,
    };
  });

  const seen = new Set<string>();
  const traps = (trapsIn as unknown[]).map((t, j): Trap => {
    const p = `usage.traps[${j}]`;
    if (!isObj(t)) return fail(`${p}: must be an object`);
    keys(t, ["id", "call_site", "fix"], p);
    if (typeof t.id !== "string" || !(TRAPS as readonly string[]).includes(t.id)) fail(`${p}.id: unknown trap`);
    const wide = APP_WIDE_TRAPS.includes(t.id as string);
    if (wide) { if (t.call_site !== null && t.call_site !== undefined) fail(`${p}.call_site: must be null for this trap`); }
    else if (!int(t.call_site, 0, call_sites.length - 1)) fail(`${p}.call_site: must be a valid call site index`);
    if (typeof t.fix !== "string" || !FIX.test(t.fix)) fail(`${p}.fix: invalid`);
    const key = `${t.id}:${(t.call_site as number | null | undefined) ?? "null"}`;
    if (seen.has(key)) fail(`${p}: duplicate`);
    seen.add(key);
    return { id: t.id as TrapId, call_site: wide ? null : (t.call_site as number), fix: t.fix as string };
  });

  const per_user: Usage["per_user"] = {};
  if (json.per_user !== undefined) {
    if (!isObj(json.per_user)) fail("usage.per_user: must be an object");
    const pu = json.per_user as Record<string, unknown>;
    keys(pu, ["emails_per_month", "storage_mb"], "usage.per_user");
    for (const k of ["emails_per_month", "storage_mb"] as const) {
      if (pu[k] === undefined) continue;
      if (typeof pu[k] !== "number" || !Number.isFinite(pu[k]) || (pu[k] as number) < 0 || (pu[k] as number) > 1e6) fail(`usage.per_user.${k}: must be a number 0..1000000`);
      per_user[k] = pu[k] as number;
    }
  }
  return { schema: 1, call_sites, traps, per_user };
}
