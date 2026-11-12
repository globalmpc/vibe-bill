import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { detect, type Detect } from "./detect/index";
import { assertNotEnvFile } from "./detect/env-names";
import { billJson, calcBill, parseUsage, resolveAssumptions } from "./engine/index";
import { loadPricing } from "./pricing/schema";
import { getLlmPrices, type LlmModel, type LlmPrices } from "./pricing/openrouter";
import { allQuestions, applyAnswers, fillDefaults, getValue, LLM_NAMES, MAX_QUESTIONS, pendingQuestions, readConfig, writeAtomic, writeConfig } from "./questions/index";
import { approx, defaultTier, fmtInt, money, parseBill, projectName, renderHtml, renderReceipt, topFix, type Brand } from "./render/index";
import { canonicalLocal, listLocal, MAX_INPUT, mergeLocal, parseEntries, readLocal } from "./pricing/local";
import { renderReport } from "./render/report";
import { loadPng } from "./render/png";
import brand from "../data/brand.json";
import pricingJson from "../data/pricing.json";
import snap from "../data/openrouter-snapshot.json";

declare const __VERSION__: string;
export const version = typeof __VERSION__ === "undefined" ? "dev" : __VERSION__;

const USAGE = "usage: vibe-bill <detect|questions|answer|calc|price|render> | --version\n  calc <path> [--no-questions] [--live-prices]\n  price <path> [<entries.json>]\n  render <path> [--tier N]\n";
const PRICING = loadPricing(pricingJson);
const SNAP: LlmPrices = { source: "snapshot", fetched_at: snap.fetched_at, models: snap.models as unknown as Record<string, LlmModel> };

function dirArg(path: string): string | null {
  const root = resolve(path);
  try { return statSync(root).isDirectory() ? root : null; } catch { return null; }
}
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

/** detect() plus the LLM providers the user declared in config.json (apps behind a proxy show no SDK or env name). */
function detectAll(root: string): Detect {
  const d = detect(root);
  for (const id of readConfig(root, PRICING).llm_providers) {
    if (d.services.some((s) => s.id === id)) continue;
    d.services.push({ id, evidence: ["declared in config.json"], confidence: "high", model: null, model_reason: "provider declared by you; no model found in code" });
  }
  return d;
}

function readJson(file: string, max: number, label: string): unknown {
  assertNotEnvFile(file);
  let size = 0;
  try { size = statSync(file).size; } catch { throw new Error(`cannot read ${label}`); }
  if (size > max) throw new Error(`${label} too large`);
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { throw new Error(`${label} is not valid JSON`); }
}

function phase3(cmd: string, argv: string[]): { code: number; out: string; err: string } {
  const args = argv.slice(1).filter((a) => a !== "--no-questions");
  const root = args[0] ? dirArg(args[0]) : null;
  if (!args[0] || (cmd === "answer" && !args[1])) return { code: 1, out: "", err: `usage: vibe-bill ${cmd === "answer" ? "answer <path> <answers.json>" : "questions <path> [--no-questions]"}\n` };
  if (!root) return { code: 1, out: "", err: `${cmd}: not a directory\n` };
  try {
    const cfg = readConfig(root, PRICING);
    if (cmd === "answer") {
      writeConfig(root, applyAnswers(cfg, readJson(resolve(args[1]), 64 * 1024, "answers file"), PRICING));
      return { code: 0, out: "wrote .vibe-bill/config.json\n", err: "" };
    }
    const qs = allQuestions(detectAll(root), PRICING, SNAP);
    if (argv.includes("--no-questions")) {
      const n = fillDefaults(cfg, qs);
      writeConfig(root, n);
      const val = (k: string) => { const d = k.indexOf("."); return (n as never as Record<string, Record<string, unknown>>)[k.slice(0, d)][k.slice(d + 1)]; };
      return { code: 0, out: json({ assumed: n.assumed.map((key) => ({ key, value: val(key) })) }), err: "" };
    }
    return { code: 0, out: json({ schema: 1, llm_prices: { source: SNAP.source, fetched_at: SNAP.fetched_at }, questions: pendingQuestions(qs, cfg).slice(0, MAX_QUESTIONS) }), err: "" };
  } catch (e) {
    return { code: 1, out: "", err: `${cmd}: ${e instanceof Error ? e.message : "failed"}\n` };
  }
}

function calc(argv: string[], opts: { llm?: LlmPrices; now?: Date }): { code: number; out: string; err: string } {
  const args = argv.slice(1).filter((a) => !a.startsWith("--"));
  const root = args[0] ? dirArg(args[0]) : null;
  if (!args[0]) return { code: 1, out: "", err: "usage: vibe-bill calc <path> [--no-questions] [--live-prices]\n" };
  if (!root) return { code: 1, out: "", err: "calc: not a directory\n" };
  try {
    const up = join(root, ".vibe-bill", "out", "usage.json");
    try { statSync(up); } catch { throw new Error("usage.json not found (run the analysis first)"); }
    const llm = opts.llm ?? SNAP;
    const d = detectAll(root);
    const usage = parseUsage(readJson(up, 256 * 1024, "usage.json"), d.services.map((s) => s.id).filter((id) => id in LLM_NAMES));
    let cfg = readConfig(root, PRICING);
    const qs = allQuestions(d, PRICING, SNAP);
    const noQ = argv.includes("--no-questions");
    if (noQ) cfg = fillDefaults(cfg, qs);
    else {
      const ids = pendingQuestions(qs, cfg).filter((q) => getValue(cfg, q.id) === undefined).map((q) => q.id);
      if (ids.length) throw new Error(`unanswered questions: ${ids.join(", ")} (run answer, or pass --no-questions)`);
    }
    const bill = billJson(calcBill({ detect: d, config: cfg, usage, assumptions: resolveAssumptions(cfg.assumptions, usage.per_user), pricing: PRICING, llm, now: opts.now ?? new Date(), local: readLocal(root, PRICING) }));
    let out = "";
    if (noQ) { writeConfig(root, cfg); out += "wrote .vibe-bill/config.json\n"; }
    writeAtomic(join(root, ".vibe-bill", "out", "bill.json"), bill);
    return { code: 0, out: out + "wrote .vibe-bill/out/bill.json\n", err: "" };
  } catch (e) {
    return { code: 1, out: "", err: `calc: ${e instanceof Error ? e.message : "failed"}\n` };
  }
}

function price(argv: string[], opts: { now?: Date }): { code: number; out: string; err: string } {
  const args = argv.slice(1);
  const root = args[0] ? dirArg(args[0]) : null;
  if (!args[0] || args.length > 2) return { code: 1, out: "", err: "usage: vibe-bill price <path> [<entries.json>]\n" };
  if (!root) return { code: 1, out: "", err: "price: not a directory\n" };
  try {
    const now = opts.now ?? new Date();
    const hints = detect(root).unknown_services.map((u) => u.hint);
    const cur = readLocal(root, PRICING);
    if (!args[1]) return { code: 0, out: json(listLocal(cur, hints, now)), err: "" };
    const add = parseEntries(readJson(resolve(args[1]), MAX_INPUT, "entries file"), hints, now, PRICING);
    mkdirSync(join(root, ".vibe-bill"), { recursive: true });
    writeAtomic(join(root, ".vibe-bill", "prices.local.json"), canonicalLocal(mergeLocal(cur, add)));
    return { code: 0, out: "wrote .vibe-bill/prices.local.json\n", err: "" };
  } catch (e) {
    return { code: 1, out: "", err: `price: ${e instanceof Error ? e.message : "failed"}\n` };
  }
}

type Png = (svg: string) => Uint8Array;

function render(argv: string[], opts: { png?: Png }): { code: number; out: string; err: string } {
  const ti = argv.indexOf("--tier");
  const tierArg = ti >= 0 ? argv[ti + 1] : undefined;
  const args = argv.slice(1).filter((a, k) => !a.startsWith("--") && !(ti >= 0 && k === ti));
  const root = args[0] ? dirArg(args[0]) : null;
  if (!args[0]) return { code: 1, out: "", err: "usage: vibe-bill render <path> [--tier N]\n" };
  if (!root) return { code: 1, out: "", err: "render: not a directory\n" };
  try {
    const dir = join(root, ".vibe-bill", "out");
    const need = (f: string, msg: string) => { if (!existsSync(join(dir, f))) throw new Error(msg); return join(dir, f); };
    const bill = parseBill(readJson(need("bill.json", "bill.json not found (run calc first)"), 1024 * 1024, "bill.json"));
    const d = detectAll(root);
    const usage = parseUsage(readJson(need("usage.json", "usage.json not found (run the analysis first)"), 256 * 1024, "usage.json"), d.services.map((s) => s.id).filter((id) => id in LLM_NAMES));
    const users = bill.tiers.map((x) => x.users);
    let t = defaultTier(bill);
    if (ti >= 0) {
      t = tierArg !== undefined && /^[0-9]+$/.test(tierArg) ? users.indexOf(Number(tierArg)) : -1;
      if (t < 0) throw new Error(`--tier must be one of ${users.join(", ")}`);
    }
    const project = projectName(root);
    const svg = renderReceipt(bill, t, project, brand as Brand);
    const report = renderReport({ bill, usage, config: readConfig(root, PRICING), detect: d, pricing: PRICING, snap: SNAP, project, tierIdx: t, local: readLocal(root, PRICING) });
    let err = "";
    let png: Uint8Array | undefined;
    if (opts.png) { try { png = opts.png(svg); } catch { err = "receipt.png skipped: render failed\n"; } }
    else err = "receipt.png skipped: renderer not available\n";
    const files: [string, string | Uint8Array][] = [["receipt.svg", svg]];
    if (png) files.push(["receipt.png", png]);
    files.push(["receipt.html", renderHtml(svg, !!png)], ["report.md", report]);
    mkdirSync(dir, { recursive: true });
    for (const [n, c] of files) writeAtomic(join(dir, n), c);
    const top = topFix(bill, t);
    const summary = `total at ${fmtInt(bill.tiers[t].users)} users: ${money(bill.tiers[t].total)}/month\n`
      + (top?.kind === "fix" ? `top fix: ${top.fix} (saves ${approx(top.saves)}/month)\n` : top ? `top risk: ${top.fix} (abuse cost not estimated)\n` : "");
    return { code: 0, out: files.map(([n]) => `wrote ${relative(root, join(dir, n)).split("\\").join("/")}\n`).join("") + summary, err };
  } catch (e) {
    return { code: 1, out: "", err: `render: ${e instanceof Error ? e.message : "failed"}\n` };
  }
}

export function run(argv: string[], opts: { llm?: LlmPrices; now?: Date; png?: Png } = {}): { code: number; out: string; err: string } {
  const [cmd, path] = argv;
  if (cmd === "--version") return { code: 0, out: version + "\n", err: "" };
  if (cmd === "detect") {
    if (!path) return { code: 1, out: "", err: "usage: vibe-bill detect <path>\n" };
    const root = dirArg(path);
    if (!root) return { code: 1, out: "", err: "detect: not a directory\n" };
    const dir = join(root, ".vibe-bill", "out");
    mkdirSync(dir, { recursive: true });
    try { writeAtomic(join(dir, "detect.json"), json(detectAll(root))); } catch (e) { return { code: 1, out: "", err: `detect: ${e instanceof Error ? e.message : "failed"}\n` }; }
    return { code: 0, out: "wrote .vibe-bill/out/detect.json\n", err: "" };
  }
  if (cmd === "questions" || cmd === "answer") return phase3(cmd, argv);
  if (cmd === "calc") return calc(argv, opts);
  if (cmd === "price") return price(argv, opts);
  if (cmd === "render") return render(argv, opts);
  return { code: cmd ? 1 : 0, out: "", err: USAGE };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const live = argv[0] === "calc" && argv.includes("--live-prices");
  let png: Png | undefined, warn = "";
  if (argv[0] === "render") png = await loadPng().catch((e) => { warn = `receipt.png skipped: ${e instanceof Error ? e.message.slice(0, 80) : "init failed"}\n`; return undefined; });
  const r = run(argv, live ? { llm: await getLlmPrices({ snapshot: SNAP }) } : { png });
  if (warn) r.err = r.err.replace(/receipt\.png skipped: renderer not available\n/, warn);
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  process.exitCode = r.code;
}
