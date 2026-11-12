import { basename } from "node:path";
import type { Bill } from "../engine/index";
import { TRAPS } from "../engine/usage";

export type Brand = { repo_url: string; search: string };

// ---- formatting (hand-rolled: output must not depend on the ICU build) ----
const sep = (s: string) => s.replace(/\B(?=(\d{3})+$)/g, ",");
export const fmtInt = (n: number) => sep(String(n));

export function money(x: number | null): string {
  if (x === null) return "n/a";
  if (x === 0) return "$0.00";
  if (x < 0.005) return "<$0.01";
  const [i, f] = (Math.round(x * 100) / 100).toFixed(2).split(".");
  return "$" + sep(i) + "." + f;
}
export function approx(x: number): string {
  if (x >= 1) return "~$" + sep(String(Math.round(x)));
  return x > 0 ? "<$1" : "$0";
}
export const esc = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const trunc = (s: string, n: number) => (s.length <= n ? s : s.slice(0, Math.max(0, n - 3)) + "...");

/** Greedy word wrap. First row has `width` columns, later rows `width - indent`. Overflow past maxRows ends in "...". */
export function wrap(text: string, width: number, indent = 0, maxRows = Infinity): string[] {
  const rows: string[] = [];
  let cur = "";
  for (let word of text.split(/\s+/).filter(Boolean)) {
    for (;;) {
      const room = rows.length ? width - indent : width;
      if (!cur) {
        if (word.length <= room) { cur = word; break; }
        rows.push(word.slice(0, room)); word = word.slice(room);
      } else if (cur.length + 1 + word.length <= room) { cur += " " + word; break; }
      else { rows.push(cur); cur = ""; }
    }
  }
  if (cur) rows.push(cur);
  if (rows.length > maxRows) {
    rows.length = maxRows;
    const room = maxRows > 1 ? width - indent : width;
    rows[maxRows - 1] = rows[maxRows - 1].slice(0, room - 3) + "...";
  }
  return rows;
}

export function projectName(root: string): string {
  const n = basename(root).replace(/[^A-Za-z0-9 ._-]/g, "").trim().slice(0, 30).trim();
  return n || "my app";
}

// ---- bill.json validation (trust boundary: the file is hand-editable) ----
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (path: string): never => { throw new Error(`bill.json.${path}: invalid`); };
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const str = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ponytail: checks shape and types only, not content; bill.json is our own output. Add charset filtering if it ever takes outside input. */
export function parseBill(j: unknown): Bill {
  if (!isObj(j) || j.schema !== 1) return fail("schema");
  if (!Array.isArray(j.tiers) || j.tiers.length < 1 || j.tiers.length > 20) return fail("tiers");
  const tiers = j.tiers as unknown[];
  tiers.forEach((t, i) => {
    const p = `tiers[${i}]`;
    if (!isObj(t)) return fail(p);
    if (!Number.isInteger(t.users) || (t.users as number) < 1) fail(`${p}.users`);
    if (!num(t.total)) fail(`${p}.total`);
    if (!Array.isArray(t.lines) || t.lines.length > 200) return fail(`${p}.lines`);
    if (!Array.isArray(t.key_assumptions) || t.key_assumptions.length < 1 || t.key_assumptions.length > 3 || !t.key_assumptions.every((s) => str(s, 200))) fail(`${p}.key_assumptions`);
    const first = (tiers[0] as { lines: unknown[] }).lines;
    if (t.lines.length !== first.length) fail(`${p}.lines`);
    t.lines.forEach((l: unknown, k: number) => {
      const q = `${p}.lines[${k}]`;
      if (!isObj(l)) return fail(q);
      if (!str(l.service, 100)) fail(`${q}.service`);
      if (!str(l.label, 100)) fail(`${q}.label`);
      if (l.plan !== null && !str(l.plan, 100)) fail(`${q}.plan`);
      if (l.amount !== null && !num(l.amount)) fail(`${q}.amount`);
      if (l.upgraded_from !== undefined && !str(l.upgraded_from, 100)) fail(`${q}.upgraded_from`);
      for (const f of ["unpriced", "unverified", "stale"]) if (l[f] !== undefined && l[f] !== true) fail(`${q}.${f}`);
      if (l.traps !== undefined && (!Array.isArray(l.traps) || l.traps.length > 20 || !l.traps.every((x) => (TRAPS as readonly string[]).includes(x as string)))) fail(`${q}.traps`);
      const f0 = first[k] as Record<string, unknown>;
      if (isObj(f0) && (f0.service !== l.service || f0.label !== l.label)) fail(`${q}.label`);
    });
  });
  if (!Array.isArray(j.traps) || j.traps.length > 100) return fail("traps");
  j.traps.forEach((t: unknown, i: number) => {
    const p = `traps[${i}]`;
    if (!isObj(t)) return fail(p);
    if (!(TRAPS as readonly string[]).includes(t.id as string)) fail(`${p}.id`);
    if (!str(t.fix, 100)) fail(`${p}.fix`);
    if (t.call_site !== null && !Number.isInteger(t.call_site)) fail(`${p}.call_site`);
    const s = t.savings_by_tier;
    if (s !== null && (!Array.isArray(s) || s.length !== tiers.length || !s.every(num))) fail(`${p}.savings_by_tier`);
  });
  const pa = j.prices_as_of;
  if (!isObj(pa) || !isObj(pa.llm)) return fail("prices_as_of");
  if (!str(pa.llm.source, 40) || !str(pa.llm.date, 10) || !DATE.test(pa.llm.date as string) || typeof pa.llm.stale !== "boolean") fail("prices_as_of.llm");
  if (pa.other_oldest !== null && !(str(pa.other_oldest, 10) && DATE.test(pa.other_oldest as string))) fail("prices_as_of.other_oldest");
  for (const k of ["stale", "needs_check"]) if (!Array.isArray(pa[k]) || !(pa[k] as unknown[]).every((s) => str(s, 100))) fail(`prices_as_of.${k}`);
  if (!isObj(j.assumptions) || !Object.values(j.assumptions).every((v) => typeof v === "number" && Number.isFinite(v))) fail("assumptions");
  if (!isObj(j.assumption_sources) || !Object.values(j.assumption_sources).every((v) => v === "usage" || v === "config")) fail("assumption_sources");
  if (!Array.isArray(j.assumed) || !j.assumed.every((s) => str(s, 100))) fail("assumed");
  return j as unknown as Bill;
}

/** Default tier = 10,000 users (D-011), else the last tier. */
export function defaultTier(bill: Bill): number {
  const i = bill.tiers.findIndex((t) => t.users === 10000);
  return i >= 0 ? i : bill.tiers.length - 1;
}

// ---- receipt SVG ----
const FONT = "'Liberation Mono','Cousine','Courier New',monospace";
const BG = "#fbf8f1", INK = "#1f1f1f", DIM = "#6b6b6b", WARN = "#b45309";
const COLS = 54, MAX_ROWS = 8;
type L = Bill["tiers"][number]["lines"][number];

const marksOf = (l: Pick<L, "upgraded_from" | "unverified" | "stale" | "unpriced">) => [
  ...(l.upgraded_from ? [`(upgraded from ${l.upgraded_from})`] : []),
  ...(l.unverified ? ["(unverified)"] : []),
  ...(l.stale ? ["(price may be outdated)"] : []),
  ...(l.unpriced ? ["(no price found)"] : []),
];

/** Marks are never cut: shorten the plan first, wrap if the marks alone are too long. */
function subRows(plan: string, marks: string[]): string[] {
  const rest = marks.map((m) => " " + m).join("");
  if (plan.length + rest.length <= 50) return (plan + rest).trim() ? [(plan + rest).trim()] : [];
  const room = 50 - rest.length;
  return room >= 8 ? [trunc(plan, room) + rest] : wrap((plan + rest).trim(), 50);
}

/** Biggest saving at tier t, else the first unbounded-cost risk, else null. Shared by the receipt and the render summary. */
export function topFix(bill: Bill, t: number): { kind: "fix"; fix: string; saves: number } | { kind: "risk"; fix: string } | null {
  const sv = (tr: Bill["traps"][number]) => tr.savings_by_tier?.[t];
  let best: Bill["traps"][number] | undefined;
  for (const tr of bill.traps) if ((sv(tr) ?? 0) > (best ? sv(best)! : 0)) best = tr;
  if (best) return { kind: "fix", fix: best.fix, saves: sv(best)! };
  const risk = bill.traps.find((tr) => tr.savings_by_tier === null);
  return risk ? { kind: "risk", fix: risk.fix } : null;
}

export function renderReceipt(bill: Bill, t: number, project: string, brand: Brand): string {
  const tier = bill.tiers[t];
  const body: string[] = [];
  let y = 32, last = 0;
  const row = (size: 16 | 20) => { last = y + (size === 20 ? 20 : 18); y += size === 20 ? 28 : 24; return last; };
  const text = (x: number, size: 16 | 20, s: string, o: { anchor?: "middle" | "end"; dim?: boolean } = {}) =>
    body.push(`<text x="${x}" y="${row(size)}" font-size="${size}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.dim ? ` fill="${DIM}"` : ""}>${esc(s)}</text>`);
  const rule = () => { body.push(`<line x1="32" y1="${y + 8}" x2="568" y2="${y + 8}" stroke="${DIM}" stroke-dasharray="4 4"/>`); y += 16; };
  const amountRow = (x: number, size: 16 | 20, label: string, amount: string) => {
    const yy = row(size);
    body.push(`<text x="${x}" y="${yy}" font-size="${size}">${esc(label)}</text>`);
    body.push(`<text x="568" y="${yy}" font-size="${size}" text-anchor="end">${esc(amount)}</text>`);
    return yy;
  };
  const triangle = (base: number) => body.push(`<path d="M39,${base - 12} l7,12 h-14 z" fill="${WARN}"/><rect x="38" y="${base - 8}" width="2" height="4" fill="${BG}"/><rect x="38" y="${base - 3}" width="2" height="2" fill="${BG}"/>`);

  text(32, 20, `VIBE BILL — ${project}`);
  text(300, 16, "ESTIMATE", { anchor: "middle" });
  text(300, 16, `@ ${fmtInt(tier.users)} users / month`, { anchor: "middle" });
  rule();

  type Item = { label: string; amount: number | null; trap: boolean; plan: string; marks: string[] };
  const order = tier.lines.map((l, i) => ({ l, i })).sort((a, b) => (b.l.amount ?? -1) - (a.l.amount ?? -1) || a.i - b.i);
  const items: Item[] = [];
  const shown = order.length > MAX_ROWS ? order.slice(0, MAX_ROWS - 1) : order;
  for (const { l } of shown) items.push({ label: l.label, amount: l.amount, trap: !!l.traps?.length, plan: (l.plan ?? "").replace(/^~/, ""), marks: marksOf(l) });
  if (order.length > shown.length) {
    const rest = order.slice(shown.length).map((o) => o.l);
    const has = (f: "unverified" | "stale" | "unpriced") => rest.some((l) => l[f]);
    items.push({
      label: `Other (${rest.length} lines)`, amount: rest.reduce((s, l) => s + (l.amount ?? 0), 0), trap: rest.some((l) => l.traps?.length), plan: "",
      marks: marksOf({ unverified: has("unverified") || undefined, stale: has("stale") || undefined, unpriced: has("unpriced") || undefined } as never),
    });
  }
  for (const it of items) {
    const amt = money(it.amount);
    const yy = row(16);
    if (it.trap) triangle(yy);
    body.push(`<text x="52" y="${yy}" font-size="16">${esc(trunc(it.label, COLS - 2 - amt.length - 2))}</text>`);
    body.push(`<text x="568" y="${yy}" font-size="16" text-anchor="end">${esc(amt)}</text>`);
    for (const s of subRows(it.plan, it.marks)) text(70, 16, s, { dim: true });
  }
  rule();
  amountRow(32, 20, "TOTAL", money(tier.total));
  const unpriced = tier.lines.filter((l) => l.amount === null).length;
  if (unpriced) text(32, 16, `(excludes ${unpriced} unpriced line${unpriced > 1 ? "s" : ""})`, { dim: true });
  rule();

  const top = topFix(bill, t);
  const fix = top?.kind === "fix" ? `Top fix: ${top.fix} → saves ${approx(top.saves)}/month` : top ? `Top risk: ${top.fix} (abuse cost not estimated)` : "";
  if (fix) wrap(fix, COLS, 2).forEach((s, i) => text(i ? 52 : 32, 16, s));
  wrap("Assumes: " + tier.key_assumptions.join(" · "), COLS, 2, 6).forEach((s, i) => text(i ? 52 : 32, 16, s));

  const pa = bill.prices_as_of;
  const src = pa.llm.source === "snapshot" ? "OpenRouter snapshot" : pa.llm.source === "openrouter" ? "OpenRouter live" : pa.llm.source;
  let prices = `LLM prices: ${src} ${pa.llm.date}${pa.llm.stale ? " (may be outdated)" : ""}`;
  if (pa.other_oldest) prices += ` · Other prices checked ${pa.other_oldest}${pa.stale.length ? " (some may be outdated)" : ""}`;
  wrap(prices, COLS, 2).forEach((s, i) => text(i ? 52 : 32, 16, s, { dim: true }));
  rule();
  text(300, 16, brand.repo_url, { anchor: "middle", dim: true });
  text(300, 16, brand.search, { anchor: "middle", dim: true });

  const h = last + 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${h}" viewBox="0 0 600 ${h}" font-family="${FONT}" fill="${INK}">\n<rect width="600" height="${h}" fill="${BG}"/>\n${body.join("\n")}\n</svg>\n`;
}

export function renderHtml(svg: string, hasPng: boolean): string {
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>vibe-bill receipt</title>\n<style>body{margin:0;padding:16px;background:#eee;text-align:center}svg{max-width:100%;height:auto}a{display:block;margin:12px;font:16px sans-serif}</style></head>\n<body>\n${svg}${hasPng ? '<a href="receipt.png" download>Download receipt.png</a>\n' : ""}</body></html>\n`;
}
