// src/cli.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync2, readFileSync as readFileSync6, statSync as statSync4 } from "node:fs";
import { join as join5, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// src/detect/index.ts
import { existsSync, readdirSync, readFileSync as readFileSync2, statSync } from "node:fs";
import { extname, join as join2, basename as basename2 } from "node:path";

// src/detect/env-names.ts
import { readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
var BUILTIN = /* @__PURE__ */ new Set(["NODE_ENV", "MODE", "DEV", "PROD", "SSR", "BASE_URL"]);
var MAX = 1024 * 1024;
function isEnvFile(rel) {
  return /^\.env(\.|$)/.test(basename(rel));
}
function assertNotEnvFile(p) {
  let real = null;
  try {
    real = realpathSync(p);
  } catch {
  }
  if (isEnvFile(p) || real !== null && isEnvFile(real)) throw new Error("refusing to read an env file");
}
var CODE_PATTERNS = [
  /process\.env\.(\w+)/g,
  /process\.env\[\s*["'`](\w+)["'`]\s*\]/g,
  /import\.meta\.env\.(\w+)/g,
  /os\.environ\[\s*["'](\w+)["']\s*\]/g,
  /os\.environ\.get\(\s*["'](\w+)["']/g,
  /os\.getenv\(\s*["'](\w+)["']/g,
  /Deno\.env\.get\(\s*["'](\w+)["']/g
];
function matchAll(text, re) {
  return [...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))].map((m) => m[1]);
}
var uniq = (a) => [...new Set(a)].sort();
function namesFromCode(text) {
  return uniq(CODE_PATTERNS.flatMap((re) => matchAll(text, re)).filter((n) => !BUILTIN.has(n)));
}
function namesFromConfig(rel, text) {
  const b = basename(rel);
  const out = [];
  if (/^docker-compose.*\.ya?ml$/.test(b)) {
    for (const re of [/^\s*-\s*([A-Z][A-Z0-9_]*)\s*(?:=|$)/gm, /^\s+([A-Z][A-Z0-9_]*)\s*:/gm, /\$\{([A-Z][A-Z0-9_]*)/g]) out.push(...matchAll(text, re));
  } else if (b === "vercel.json") {
    for (const blk of text.match(/"env"\s*:\s*\{[^}]*\}/g) ?? []) out.push(...matchAll(blk.replace(/^"env"\s*:/, ""), /"([A-Z][A-Z0-9_]*)"\s*:/g));
  } else if (b === "netlify.toml" || b === "wrangler.toml") {
    out.push(...matchAll(text, /^\s*([A-Z][A-Z0-9_]*)\s*=/gm));
  }
  return uniq(out);
}
function namesFromEnvText(text) {
  const out = [];
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
function safeRead(path) {
  try {
    const t = readFileSync(path, "utf8");
    return t.length > MAX ? "" : t;
  } catch {
    return "";
  }
}
function collectEnvNames(root, files, code2) {
  const seen = /* @__PURE__ */ new Map();
  const add = (names, source) => names.forEach((name) => seen.set(name + "\0" + source, { name, source }));
  for (const text of code2.values()) add(namesFromCode(text), "code");
  for (const rel of files) {
    if (isEnvFile(rel)) add(namesFromEnvText(safeRead(join(root, rel))), /\.(example|sample|template)$/.test(rel) ? "example" : "dotenv");
    else if (/^(docker-compose.*\.ya?ml|vercel\.json|netlify\.toml|wrangler\.toml)$/.test(basename(rel))) add(namesFromConfig(rel, safeRead(join(root, rel))), "config");
  }
  return [...seen.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
}

// src/detect/index.ts
var LLM = /* @__PURE__ */ new Set(["openai", "anthropic", "google", "openrouter"]);
var SERVICES = [
  { id: "openai", pkgs: ["openai", "@ai-sdk/openai"], env: ["OPENAI_API_KEY"], prefix: ["OPENAI"] },
  { id: "anthropic", pkgs: ["@anthropic-ai/sdk", "anthropic", "@ai-sdk/anthropic"], env: ["ANTHROPIC_API_KEY"], prefix: ["ANTHROPIC"] },
  { id: "google", pkgs: ["@google/genai", "@google/generative-ai", "google-genai", "google.genai", "google.generativeai", "@ai-sdk/google"], env: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], prefix: ["GEMINI", "GOOGLE"] },
  { id: "openrouter", pkgs: ["@openrouter/ai-sdk-provider"], env: ["OPENROUTER_API_KEY"], prefix: ["OPENROUTER"] },
  { id: "supabase", pkgs: ["@supabase/supabase-js", "@supabase/ssr", "supabase"], env: ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"], prefix: ["SUPABASE"] },
  { id: "vercel", pkgs: [], env: [], prefix: ["VERCEL"] },
  { id: "clerk", pkgs: [], env: ["CLERK_SECRET_KEY"], prefix: ["CLERK"] },
  { id: "resend", pkgs: ["resend"], env: ["RESEND_API_KEY"], prefix: ["RESEND"] },
  { id: "stripe", pkgs: ["stripe", "@stripe/stripe-js"], env: ["STRIPE_SECRET_KEY"], prefix: ["STRIPE"] }
];
var PAID_SDKS = new Set("replicate cohere-ai groq-sdk @mistralai/mistralai together-ai @pinecone-database/pinecone twilio @sendgrid/mail postmark elevenlabs @deepgram/sdk @upstash/redis @vercel/blob @vercel/kv @vercel/postgres firebase firebase-admin algoliasearch @ai-sdk/mistral @ai-sdk/groq @ai-sdk/cohere".split(" "));
var GENERIC = new Set("JWT SESSION NEXTAUTH AUTH BETTER COOKIE ENCRYPTION APP WEBHOOK CRON SECRET".split(" "));
var DEPLOY_FILES = ["netlify.toml", "wrangler.toml", "fly.toml", "render.yaml", "railway.json", "railway.toml", "Dockerfile", "app.yaml", "amplify.yml", "firebase.json"];
var IGNORE = new Set("node_modules .git .vibe-bill .vercel .next .nuxt .svelte-kit .turbo .cache dist build out coverage venv .venv __pycache__ vendor target".split(" "));
var CODE_EXT = new Set(".js .jsx .ts .tsx .mjs .cjs .mts .cts .py .vue .svelte .astro".split(" "));
var MAX2 = 1024 * 1024;
var MODEL_ENV = /(?:^|_)MODEL(?:_ID|_NAME)?$/;
function walk(root, dir = "") {
  const out = [];
  let ents;
  try {
    ents = readdirSync(join2(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents.sort((a, b) => a.name < b.name ? -1 : 1)) {
    if (e.isSymbolicLink()) continue;
    const rel = dir ? dir + "/" + e.name : e.name;
    if (e.isDirectory()) {
      if (!IGNORE.has(e.name)) out.push(...walk(root, rel));
      continue;
    }
    try {
      if (!e.isFile() || statSync(join2(root, rel)).size > MAX2) continue;
    } catch {
      continue;
    }
    out.push(rel);
  }
  return out;
}
function read(root, rel) {
  if (isEnvFile(rel)) throw new Error("refusing env file");
  try {
    return readFileSync2(join2(root, rel), "utf8");
  } catch {
    return "";
  }
}
function prefixOf(name) {
  return name.replace(/^(NEXT_PUBLIC|VITE|PUBLIC|EXPO_PUBLIC|REACT_APP)_/, "").split("_")[0];
}
function jsSpec(s) {
  s = s.replace(/^(npm|jsr):/, "");
  if (/^[./]/.test(s) || s.startsWith("node:")) return null;
  return s.replace(/^(@[^/@]+\/[^/@]+|[^/@]+)[^]*$/, "$1");
}
function detect(root) {
  const files = walk(root);
  const base = (f) => basename2(f);
  const pkgs = /* @__PURE__ */ new Set();
  const code2 = /* @__PURE__ */ new Map();
  for (const f of files) {
    const b = base(f);
    if (isEnvFile(f)) continue;
    if (b === "package.json") {
      try {
        const j = JSON.parse(read(root, f));
        for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) Object.keys(j?.[k] ?? {}).forEach((d) => pkgs.add(d));
      } catch {
      }
    } else if (/^requirements.*\.txt$/.test(b)) {
      for (const l of read(root, f).split("\n")) {
        const t = l.trim();
        if (t && !t.startsWith("#")) pkgs.add(t.split(/[\s=<>!~;[]/)[0].toLowerCase());
      }
    } else if (b === "pyproject.toml") {
      for (const m of read(root, f).matchAll(/["']([A-Za-z0-9_.-]+)/g)) pkgs.add(m[1].toLowerCase());
    } else if (CODE_EXT.has(extname(f))) {
      const text = read(root, f);
      code2.set(f, text);
      if (extname(f) === ".py") {
        for (const m of text.matchAll(/^\s*(?:import|from) ([\w.]+)/gm)) {
          pkgs.add(m[1]);
          pkgs.add(m[1].split(".")[0]);
        }
      } else {
        for (const m of text.matchAll(/(?:from\s*|import\s*\(?\s*|require\(\s*)["']([^"']+)["']/g)) {
          const s = jsSpec(m[1]);
          if (s) pkgs.add(s);
        }
      }
    }
  }
  const envs = collectEnvNames(root, files, code2);
  const envNames = [...new Set(envs.map((e) => e.name))].sort();
  const known = new Set(SERVICES.flatMap((s) => s.prefix));
  const prefixSvc = new Map(SERVICES.flatMap((s) => s.prefix.map((p) => [p, s.id])));
  const flags = [];
  for (const env of envNames) {
    const svc = prefixSvc.get(prefixOf(env));
    const llm = svc && LLM.has(svc) ? svc : null;
    if (/_BASE_URL$|_API_BASE$/.test(env) && llm) flags.push({ type: "base_url", env, service: llm });
    if (MODEL_ENV.test(env)) flags.push({ type: "model_in_env", env, service: llm });
  }
  flags.sort((a, b) => a.type < b.type ? -1 : a.type > b.type ? 1 : a.env < b.env ? -1 : a.env > b.env ? 1 : 0);
  const rootFiles = new Set(files.map(base));
  const filesEv = ["vercel.json"].filter((f) => rootFiles.has(f)).map((f) => "file:" + f);
  if (existsSync(join2(root, ".vercel"))) filesEv.push("file:.vercel");
  const services = [];
  const detected = /* @__PURE__ */ new Set();
  for (const s of SERVICES) {
    const ev = [];
    for (const p of pkgs) if (s.pkgs.includes(p) || s.id === "clerk" && p.startsWith("@clerk/")) ev.push("package:" + p);
    for (const e of s.env) if (envNames.includes(e)) ev.push("env:" + e);
    if (s.id === "vercel") {
      ev.push(...filesEv);
      if (!ev.length && pkgs.has("next") && !DEPLOY_FILES.some((f) => rootFiles.has(f))) ev.push("package:next");
    }
    if (!ev.length) continue;
    ev.sort();
    const confidence = ev.some((e) => e.startsWith("package:") && s.id !== "vercel" || e.startsWith("file:")) ? "high" : ev.every((e) => e.startsWith("env:")) ? "medium" : "low";
    services.push({ id: s.id, evidence: ev, confidence, model: null, model_reason: null });
    detected.add(s.id);
  }
  services.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const lits = /* @__PURE__ */ new Map();
  for (const text of code2.values()) {
    for (const line of text.split("\n")) {
      if (!/model/i.test(line)) continue;
      for (const m of line.matchAll(/["'`]([^"'`\s$]{2,80})["'`]/g)) {
        const v = m[1];
        const id = /^(gpt-|o\d|chatgpt-)/.test(v) ? "openai" : v.startsWith("claude-") ? "anthropic" : v.startsWith("gemini-") ? "google" : /^[\w-]+\/[\w.:-]+$/.test(v) ? "openrouter" : null;
        if (id && detected.has(id)) (lits.get(id) ?? lits.set(id, /* @__PURE__ */ new Set()).get(id)).add(v);
      }
    }
  }
  for (const s of services) {
    if (!LLM.has(s.id)) continue;
    const l = [...lits.get(s.id) ?? []].sort();
    if (l.length === 1) s.model = l[0];
    else if (l.length > 1) s.model_reason = "multiple models in code: " + l.join(", ");
    else {
      const f = flags.find((x) => x.type === "model_in_env" && x.service === s.id);
      s.model_reason = f ? "set via env " + f.env : "no model literal found";
    }
  }
  const unknown = /* @__PURE__ */ new Set();
  for (const env of envNames) {
    const p = prefixOf(env);
    if (/_API_KEY$|_API_TOKEN$|_SECRET/.test(env) && !known.has(p) && !GENERIC.has(p) && !/_CLIENT_SECRET$/.test(env)) unknown.add("env:" + env);
  }
  for (const p of pkgs) if (PAID_SDKS.has(p)) unknown.add("package:" + p);
  return { schema: 1, services, unknown_services: [...unknown].sort().map((hint) => ({ hint })), flags, env_names: envNames };
}

// src/pricing/schema.ts
var UNITS = [
  "mau",
  "db_gb",
  "storage_gb",
  "egress_gb",
  "bandwidth_gb",
  "function_invocations",
  "function_gb_hours",
  "emails",
  "image_optimizations",
  "transactions",
  "transaction_volume_usd"
];
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function isValidDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = /* @__PURE__ */ new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function fail(path, msg) {
  throw new Error(`${path}: ${msg}`);
}
function num(v, path) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) fail(path, "must be a number >= 0");
  return v;
}
function str(v, path) {
  if (typeof v !== "string" || v === "") fail(path, "must be a non-empty string");
  return v;
}
function unitMap(v, path) {
  if (!isObj(v)) fail(path, "must be an object");
  for (const [k, n] of Object.entries(v)) {
    if (!UNITS.includes(k)) fail(`${path}.${k}`, "unknown unit");
    num(n, `${path}.${k}`);
  }
  return v;
}
function parsePricing(json2) {
  if (!isObj(json2)) fail("pricing", "must be an object");
  if (json2.schema !== 1) fail("schema", "must be 1");
  if (!isObj(json2.services)) fail("services", "must be an object");
  for (const [id, s] of Object.entries(json2.services)) {
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
      if (p.fee !== void 0) {
        if (!isObj(p.fee)) fail(`${pp}.fee`, "must be an object");
        num(p.fee.percent, `${pp}.fee.percent`);
        num(p.fee.fixed_usd, `${pp}.fee.fixed_usd`);
      }
      if (p.usage_credit_usd !== void 0) num(p.usage_credit_usd, `${pp}.usage_credit_usd`);
      if (p.upgrade_to !== void 0 && !names.includes(p.upgrade_to))
        fail(`${pp}.upgrade_to`, "names a plan that does not exist");
    }
    if (typeof s.default_plan !== "string" || !names.includes(s.default_plan))
      fail(`${sp}.default_plan`, "must name an existing plan");
  }
  return json2;
}
var loadPricing = parsePricing;

// src/pricing/staleness.ts
var STALE_AFTER_DAYS = 30;
var DAY = 864e5;
var day = (d) => Math.floor((typeof d === "string" ? Date.parse(d + "T00:00:00Z") : d.getTime()) / DAY);
function isStale(checked_at, now) {
  return day(now) - day(checked_at) > STALE_AFTER_DAYS;
}
function pricesAsOf(a) {
  const used = a.servicesUsed.filter((id) => Object.hasOwn(a.pricing.services, id));
  const extra = a.extra ?? [];
  const dates = [...used.map((id) => a.pricing.services[id].checked_at), ...extra.map((x) => x.checked_at)].sort();
  return {
    llm: { source: a.llm.source, date: a.llm.fetched_at, stale: isStale(a.llm.fetched_at, a.now) },
    other_oldest: dates[0] ?? null,
    stale: [...used.filter((id) => isStale(a.pricing.services[id].checked_at, a.now)), ...extra.filter((x) => isStale(x.checked_at, a.now)).map((x) => x.id)],
    needs_check: used.filter((id) => a.pricing.services[id].needs_check)
  };
}

// src/questions/config.ts
import { existsSync as existsSync2, lstatSync, mkdirSync, readFileSync as readFileSync3, renameSync, rmSync, statSync as statSync2, writeFileSync } from "node:fs";
import { basename as basename3, dirname, join as join3 } from "node:path";
var LLM_NAMES = { openai: "OpenAI", anthropic: "Anthropic", google: "Google AI", openrouter: "OpenRouter" };
var SECTIONS = ["models", "plans", "providers"];
var TOP = ["schema", "models", "plans", "providers", "assumptions", "assumed", "llm_providers"];
var KEY = /^(models|plans|providers)\.[A-Za-z0-9_]{1,64}$/;
var ASSUMED = /^(models|plans|providers|assumptions)\.[A-Za-z0-9_]{1,64}$/;
var MODEL = /^~?[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9._:~-]{1,100}$/;
var ENV = /^[A-Z][A-Z0-9_]{0,63}$/;
var PROV = /^[a-z0-9][a-z0-9._-]{0,39}$/;
var MAX_CONFIG = 256 * 1024;
var isObj2 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var fail2 = (m) => {
  throw new Error(m);
};
var cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var emptyConfig = () => ({ schema: 1, models: {}, plans: {}, providers: {}, assumptions: {}, assumed: [], llm_providers: [] });
function checkEntry(id, value, pricing, where) {
  const dot = id.indexOf(".");
  const sec = id.slice(0, dot), name = id.slice(dot + 1), p = `${where}.${id}`;
  if (sec === "models") {
    if (!Object.hasOwn(LLM_NAMES, name)) fail2(`${p}: unknown service`);
  } else if (sec === "plans") {
    if (!Object.hasOwn(pricing.services, name)) fail2(`${p}: unknown service`);
  } else if (!ENV.test(name)) fail2(`${p}: not an env var name`);
  if (typeof value !== "string") fail2(`${p}: must be a string`);
  const v = value;
  if (sec === "models") {
    if (!MODEL.test(v)) fail2(`${p}: must be a model id like provider/model`);
  } else if (sec === "plans") {
    if (v !== "none" && !Object.hasOwn(pricing.services[name].plans, v)) fail2(`${p}: unknown plan`);
  } else if (!PROV.test(v)) fail2(`${p}: must be a lowercase provider id`);
}
function parseConfig(json2, pricing) {
  if (!isObj2(json2)) return fail2("config: must be an object");
  for (const k of Object.keys(json2)) if (!TOP.includes(k)) fail2("config: unknown top-level key");
  if (json2.schema !== 1) fail2("config.schema: must be 1");
  const c = emptyConfig();
  for (const sec of SECTIONS) {
    const m = json2[sec];
    if (m === void 0) continue;
    if (!isObj2(m)) fail2(`config.${sec}: must be an object`);
    const out = {};
    Object.keys(m).sort(cmp).forEach((k, i) => {
      const id = sec + "." + k;
      if (!KEY.test(id)) fail2(`config.${sec}: key #${i} is not valid`);
      checkEntry(id, m[k], pricing, "config");
      out[k] = m[k];
    });
    c[sec] = out;
  }
  if (json2.assumptions !== void 0) {
    if (!isObj2(json2.assumptions)) fail2("config.assumptions: must be an object");
    c.assumptions = Object.fromEntries(Object.entries(json2.assumptions).sort((a, b) => cmp(a[0], b[0])));
  }
  if (json2.llm_providers !== void 0) {
    const l = json2.llm_providers;
    if (!Array.isArray(l) || l.length > Object.keys(LLM_NAMES).length) fail2("config.llm_providers: must be an array of provider ids");
    l.forEach((a, i) => {
      if (typeof a !== "string" || !Object.hasOwn(LLM_NAMES, a)) fail2(`config.llm_providers[${i}]: must be one of ${Object.keys(LLM_NAMES).join(", ")}`);
    });
    c.llm_providers = [...new Set(l)].sort(cmp);
  }
  if (json2.assumed !== void 0) {
    if (!Array.isArray(json2.assumed)) fail2("config.assumed: must be an array");
    json2.assumed.forEach((a, i) => {
      if (typeof a !== "string" || !ASSUMED.test(a)) fail2(`config.assumed[${i}]: not a config key`);
    });
    c.assumed = [...new Set(json2.assumed)].sort(cmp);
  }
  return c;
}
var cfgPath = (root) => join3(root, ".vibe-bill", "config.json");
function readConfig(root, pricing) {
  const p = cfgPath(root);
  if (!existsSync2(p)) return emptyConfig();
  assertNotEnvFile(p);
  if (statSync2(p).size > MAX_CONFIG) fail2("config.json: too large");
  let j;
  try {
    j = JSON.parse(readFileSync3(p, "utf8"));
  } catch {
    return fail2("config.json: not valid JSON");
  }
  return parseConfig(j, pricing);
}
function canonical(c) {
  const sorted = (m) => Object.fromEntries(Object.entries(m).sort((a, b) => cmp(a[0], b[0])));
  return JSON.stringify({
    schema: 1,
    models: sorted(c.models),
    plans: sorted(c.plans),
    providers: sorted(c.providers),
    assumptions: sorted(c.assumptions),
    assumed: [...new Set(c.assumed)].sort(cmp),
    ...c.llm_providers.length ? { llm_providers: [...new Set(c.llm_providers)].sort(cmp) } : {}
    // omitted when empty so existing configs stay byte-equal
  }, null, 2) + "\n";
}
function assertNoSymlinkDirs(p) {
  for (let d = dirname(p); ; d = dirname(d)) {
    if (existsSync2(d) && lstatSync(d).isSymbolicLink()) fail2(`refusing to write through symlinked directory: ${basename3(d)}`);
    if (basename3(d) === ".vibe-bill" || dirname(d) === d) return;
  }
}
function writeAtomic(p, data) {
  assertNoSymlinkDirs(p);
  const tmp = `${p}.${process.pid}.tmp`;
  rmSync(tmp, { force: true });
  try {
    writeFileSync(tmp, data, { flag: "wx" });
    renameSync(tmp, p);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}
function writeConfig(root, c) {
  mkdirSync(join3(root, ".vibe-bill"), { recursive: true });
  writeAtomic(cfgPath(root), canonical(c));
}
function getValue(c, id) {
  const dot = id.indexOf(".");
  const sec = id.slice(0, dot), k = id.slice(dot + 1);
  if (!SECTIONS.includes(sec)) return void 0;
  const m = c[sec];
  return Object.hasOwn(m, k) ? m[k] : void 0;
}
function applyAnswers(c, answers, pricing) {
  if (!isObj2(answers)) return fail2("answers: must be an object");
  const keys2 = Object.keys(answers);
  if (keys2.length > 50) fail2("answers: must be an object");
  keys2.forEach((k, i) => {
    if (!KEY.test(k)) fail2(`answers: key #${i} is not a question id`);
  });
  for (const k of keys2) checkEntry(k, answers[k], pricing, "answers");
  const n = { ...c, models: { ...c.models }, plans: { ...c.plans }, providers: { ...c.providers }, assumed: [...c.assumed] };
  for (const k of keys2) {
    const dot = k.indexOf(".");
    n[k.slice(0, dot)][k.slice(dot + 1)] = answers[k];
    n.assumed = n.assumed.filter((a) => a !== k);
  }
  return n;
}

// src/pricing/local.ts
import { existsSync as existsSync3, readFileSync as readFileSync4, statSync as statSync3 } from "node:fs";
import { join as join4 } from "node:path";
var MAX_LOCAL = 64 * 1024;
var MAX_INPUT = 16 * 1024;
var MAX_ENTRIES = 50;
var MAX_RECORD = 10;
var ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
var HINT = /^(env|package):[A-Za-z0-9@/._-]{1,100}$/;
var NAME = /^[A-Za-z0-9][A-Za-z0-9 &+-]{0,29}$/;
var URL_RE = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]*)?$/;
var UNIT = /^[a-z0-9][a-z0-9 ]{0,23}$/;
var KEYS = ["hints", "name", "source_url", "checked_at", "base_monthly", "unit", "unit_price_usd", "units_per_user_per_month"];
var isObj3 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var cmp2 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var fail3 = (m) => {
  throw new Error(m);
};
var realDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && (/* @__PURE__ */ new Date(s + "T00:00:00Z")).toISOString().slice(0, 10) === s;
var emptyLocal = () => ({ schema: 1, services: {} });
function entry(e, p, input, hintsOk, now, pricing, id) {
  if (!ID.test(id) || Object.hasOwn(pricing.services, id) || Object.hasOwn(LLM_NAMES, id)) fail3(`${p}: invalid id`);
  if (!isObj3(e)) return fail3(`${p}: must be an object`);
  Object.keys(e).forEach((k, i) => {
    if (!KEYS.includes(k) && !(k === "unverified" && !input)) fail3(`${p}: ${k === "unverified" ? "unverified not allowed" : `unknown key #${i}`}`);
  });
  if (!input && e.unverified !== true) fail3(`${p}.unverified: must be true`);
  const h = e.hints;
  if (!Array.isArray(h) || h.length < 1 || h.length > 5 || !h.every((x) => typeof x === "string" && HINT.test(x))) fail3(`${p}.hints: invalid`);
  if (hintsOk && !h.every((x) => hintsOk.includes(x))) fail3(`${p}.hints: not a detected unknown service`);
  if (typeof e.name !== "string" || !NAME.test(e.name)) fail3(`${p}.name: invalid`);
  if (typeof e.source_url !== "string" || e.source_url.length > 300 || !URL_RE.test(e.source_url)) fail3(`${p}.source_url: invalid`);
  if (typeof e.checked_at !== "string" || !realDate(e.checked_at)) fail3(`${p}.checked_at: invalid`);
  if (now && e.checked_at > now.toISOString().slice(0, 10)) fail3(`${p}.checked_at: in the future`);
  const n = (k, max) => {
    const v = e[k] ?? null;
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max)) fail3(`${p}.${k}: invalid`);
    return v;
  };
  const base = n("base_monthly", 1e6), price2 = n("unit_price_usd", 1e4), per = n("units_per_user_per_month", 1e6);
  const unit = e.unit ?? null;
  if (unit !== null && (typeof unit !== "string" || !UNIT.test(unit))) fail3(`${p}.unit: invalid`);
  if ((/* @__PURE__ */ new Set([unit === null, price2 === null, per === null])).size !== 1) fail3(`${p}: unit, unit_price_usd and units_per_user_per_month must be all set or all null`);
  return {
    hints: [...new Set(h)].sort(cmp2),
    name: e.name,
    source_url: e.source_url,
    checked_at: e.checked_at,
    base_monthly: base,
    unit,
    unit_price_usd: price2,
    units_per_user_per_month: per,
    unverified: true
  };
}
function noDupHints(s, where) {
  const seen = /* @__PURE__ */ new Set();
  for (const id of Object.keys(s)) for (const h of s[id].hints) {
    if (seen.has(h)) fail3(`${where}: a hint is under two ids`);
    seen.add(h);
  }
}
function parseLocal(json2, pricing) {
  const w = "prices.local.json";
  if (!isObj3(json2)) return fail3(`${w}: must be an object`);
  if (Object.keys(json2).some((k) => k !== "schema" && k !== "services")) fail3(`${w}: unknown top-level key`);
  if (json2.schema !== 1) fail3(`${w}.schema: must be 1`);
  const sv = json2.services ?? {};
  if (!isObj3(sv)) return fail3(`${w}.services: must be an object`);
  const ids = Object.keys(sv).sort(cmp2);
  if (ids.length > MAX_ENTRIES) fail3(`${w}.services: too many entries`);
  const services = {};
  ids.forEach((id, i) => {
    services[id] = entry(sv[id], `${w}.services[#${i}]`, false, null, null, pricing, id);
  });
  noDupHints(services, `${w}.services`);
  return { schema: 1, services };
}
function parseEntries(json2, unknownHints, now, pricing) {
  if (!isObj3(json2)) return fail3("entries: must be an object");
  const ids = Object.keys(json2);
  if (ids.length < 1 || ids.length > MAX_RECORD) fail3("entries: must have 1..10 entries");
  const out = {};
  ids.forEach((id, i) => {
    out[id] = entry(json2[id], `entries[#${i}]`, true, unknownHints, now, pricing, id);
  });
  noDupHints(out, "entries");
  return out;
}
function readLocal(root, pricing) {
  const p = join4(root, ".vibe-bill", "prices.local.json");
  if (!existsSync3(p)) return emptyLocal();
  assertNotEnvFile(p);
  if (statSync3(p).size > MAX_LOCAL) fail3("prices.local.json: too large");
  let j;
  try {
    j = JSON.parse(readFileSync4(p, "utf8"));
  } catch {
    return fail3("prices.local.json: not valid JSON");
  }
  return parseLocal(j, pricing);
}
function mergeLocal(cur, add) {
  const services = { ...cur.services, ...add };
  if (Object.keys(services).length > MAX_ENTRIES) fail3("prices.local.json.services: too many entries");
  noDupHints(services, "prices.local.json.services");
  return { schema: 1, services };
}
function canonicalLocal(l) {
  const services = Object.fromEntries(Object.keys(l.services).sort(cmp2).map((id) => {
    const e = l.services[id];
    return [id, Object.fromEntries(Object.keys(e).sort(cmp2).map((k) => [k, e[k]]))];
  }));
  return JSON.stringify({ schema: 1, services }, null, 2) + "\n";
}
function usedEntries(l, unknownHints) {
  return Object.keys(l.services).sort(cmp2).filter((id) => l.services[id].hints.some((h) => unknownHints.includes(h))).map((id) => [id, l.services[id]]);
}
function listLocal(l, unknownHints, now) {
  const fresh = new Set(Object.values(l.services).filter((e) => !isStale(e.checked_at, now)).flatMap((e) => e.hints));
  return {
    schema: 1,
    pending: unknownHints.filter((h) => !fresh.has(h)).map((hint) => ({ hint })),
    cached: Object.keys(l.services).sort(cmp2).map((id) => ({ id, hints: l.services[id].hints, checked_at: l.services[id].checked_at, stale: isStale(l.services[id].checked_at, now) }))
  };
}

// data/assumptions.default.json
var assumptions_default_default = {
  tiers: { value: [100, 1e3, 1e4, 1e5], why: "D-011: hobby launch, small product, growing product, breakout; receipt shows 10k" },
  daily_active_ratio: { value: 0.3, why: "DAU/MAU of 20-30% is typical for retained consumer apps; upper end so usage is not understated" },
  days_per_month: { value: 30, why: "average billing month" },
  messages_per_active_user_per_day: { value: 10, why: "a short daily chat session; base rate for per_message and per_keystroke sites" },
  page_views_per_active_user_per_day: { value: 5, why: "a short daily visit: home, app, 2-3 navigations; base rate for per_page_view and per_render sites" },
  polls_per_active_user_per_day: { value: 20, why: "polling once a minute over ~20 minutes of daily use; aggressive_polling multiplies this" },
  cron_runs_per_active_user_per_day: { value: 1, why: "a daily job that does one call per active user (digest); a fixed job that does not loop over users costs far less, lower it" },
  webhooks_per_active_user_per_day: { value: 1, why: "one inbound event (message, form, payment) per active user per day" },
  signups_per_active_user_per_day: { value: 0.01, why: "about 9% of users are new each month (0.01 x 30 days x 30% active)" },
  default_input_tokens: { value: 800, why: "system prompt plus a few turns of context, used when a call site gives no estimate" },
  default_output_tokens: { value: 300, why: "a 1-2 paragraph reply, used when a call site gives no estimate" },
  emails_per_user_per_month: { value: 4, why: "welcome, sign-in link, a receipt and one notification" },
  storage_mb_per_user: { value: 20, why: "a few uploaded photos or documents (~4 x 5 MB) per user" },
  db_mb_per_user: { value: 2, why: "~90 messages/user/month (0.3 x 30 x 10) x ~2 KB per row incl. indexes, kept about a year" },
  egress_mb_per_active_user_per_day: { value: 5, why: "a few dozen API/database JSON responses of ~100 KB per active day" },
  bandwidth_mb_per_page_view: { value: 1, why: "median page weight is ~2 MB but repeat views are mostly browser-cached" },
  paying_user_ratio: { value: 0.05, why: "freemium conversion is typically 2-5%; upper end so payment fees are not understated" },
  avg_payment_usd: { value: 10, why: "your own price per payment (not a vendor price); a common entry subscription, edit to yours" },
  chars_per_message: { value: 40, why: "a short typed question; keystroke_llm_call fires once per character" },
  render_loop_multiplier: { value: 5, why: "a call in a render or effect loop typically fires ~5x per view (state updates, StrictMode double render)" },
  history_input_multiplier: { value: 4, why: "resending full history over a ~10-turn chat averages ~4x the single-turn input" },
  no_prompt_cache_multiplier: { value: 1.3, why: "~30% of requests repeat an earlier prompt (retries, reloads, identical questions) and could be served from an app cache" },
  poll_seconds: { value: 5, why: "generated UIs usually poll every 2-10 s; aggressive_polling multiplies by 60 / poll_seconds" },
  uploads_per_user_per_month: { value: 2, why: "a profile photo plus an occasional image" },
  image_variants: { value: 4, why: "a responsive image is requested at ~4 widths (phone, tablet, laptop, desktop)" },
  select_all_egress_multiplier: { value: 3, why: "select('*') typically returns ~3x the columns a screen needs" }
};

// src/engine/usage.ts
var TRIGGERS = ["per_message", "per_page_view", "per_keystroke", "per_render", "per_poll", "per_cron_run", "per_webhook", "per_signup"];
var TRAPS = [
  "keystroke_llm_call",
  "render_loop_llm_call",
  "unbounded_history",
  "top_model_for_trivial_task",
  "no_prompt_cache",
  "public_ai_endpoint_no_rate_limit",
  "aggressive_polling",
  "image_optimization_on_uploads",
  "select_all_egress",
  "files_in_db"
];
var APP_WIDE_TRAPS = ["image_optimization_on_uploads", "select_all_egress", "files_in_db"];
var FEATURE = /^[A-Za-z0-9][A-Za-z0-9 ,'()&+-]{0,39}$/;
var FIX = /^[A-Za-z0-9][A-Za-z0-9 ,;:'()&+%-]{0,99}$/;
var isObj4 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var fail4 = (m) => {
  throw new Error(m);
};
var unset = (v) => v === void 0 || v === null;
var int = (v, lo, hi) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
function keys(o, allowed, path) {
  Object.keys(o).forEach((k, i) => {
    if (!allowed.includes(k)) fail4(`${path}: unknown key #${i}`);
  });
}
function parseUsage(json2, llmServices) {
  if (!isObj4(json2)) return fail4("usage: must be an object");
  keys(json2, ["schema", "call_sites", "traps", "per_user"], "usage");
  if (json2.schema !== 1) fail4("usage.schema: must be 1");
  if (!Array.isArray(json2.call_sites) || json2.call_sites.length > 100) fail4("usage.call_sites: must be an array of at most 100");
  const trapsIn = json2.traps ?? [];
  if (!Array.isArray(trapsIn) || trapsIn.length > 100) fail4("usage.traps: must be an array of at most 100");
  const call_sites = json2.call_sites.map((c, i) => {
    const p = `usage.call_sites[${i}]`;
    if (!isObj4(c)) return fail4(`${p}: must be an object`);
    keys(c, ["service", "feature", "file", "line", "trigger", "est_input_tokens", "est_output_tokens", "notes"], p);
    if (typeof c.service !== "string" || !llmServices.includes(c.service)) fail4(`${p}.service: not a detected LLM service`);
    if (typeof c.feature !== "string" || !FEATURE.test(c.feature)) fail4(`${p}.feature: invalid`);
    if (typeof c.trigger !== "string" || !TRIGGERS.includes(c.trigger)) fail4(`${p}.trigger: unknown trigger`);
    for (const k of ["est_input_tokens", "est_output_tokens"]) if (!unset(c[k]) && !int(c[k], 0, 2e6)) fail4(`${p}.${k}: must be an integer 0..2000000`);
    if (!unset(c.file) && (typeof c.file !== "string" || c.file.length > 300)) fail4(`${p}.file: must be a string up to 300 characters`);
    if (!unset(c.line) && !int(c.line, 1, 1e7)) fail4(`${p}.line: must be an integer 1..10000000`);
    if (!unset(c.notes) && (typeof c.notes !== "string" || c.notes.length > 500)) fail4(`${p}.notes: must be a string up to 500 characters`);
    return {
      service: c.service,
      feature: c.feature,
      file: c.file ?? null,
      line: c.line ?? null,
      trigger: c.trigger,
      est_input_tokens: c.est_input_tokens ?? null,
      est_output_tokens: c.est_output_tokens ?? null,
      notes: c.notes ?? null
    };
  });
  const seen = /* @__PURE__ */ new Set();
  const traps = trapsIn.map((t, j) => {
    const p = `usage.traps[${j}]`;
    if (!isObj4(t)) return fail4(`${p}: must be an object`);
    keys(t, ["id", "call_site", "fix"], p);
    if (typeof t.id !== "string" || !TRAPS.includes(t.id)) fail4(`${p}.id: unknown trap`);
    const wide = APP_WIDE_TRAPS.includes(t.id);
    if (wide) {
      if (t.call_site !== null && t.call_site !== void 0) fail4(`${p}.call_site: must be null for this trap`);
    } else if (!int(t.call_site, 0, call_sites.length - 1)) fail4(`${p}.call_site: must be a valid call site index`);
    if (typeof t.fix !== "string" || !FIX.test(t.fix)) fail4(`${p}.fix: invalid`);
    const key = `${t.id}:${t.call_site ?? "null"}`;
    if (seen.has(key)) fail4(`${p}: duplicate`);
    seen.add(key);
    return { id: t.id, call_site: wide ? null : t.call_site, fix: t.fix };
  });
  const per_user = {};
  if (json2.per_user !== void 0) {
    if (!isObj4(json2.per_user)) fail4("usage.per_user: must be an object");
    const pu = json2.per_user;
    keys(pu, ["emails_per_month", "storage_mb"], "usage.per_user");
    for (const k of ["emails_per_month", "storage_mb"]) {
      if (pu[k] === void 0) continue;
      if (typeof pu[k] !== "number" || !Number.isFinite(pu[k]) || pu[k] < 0 || pu[k] > 1e6) fail4(`usage.per_user.${k}: must be a number 0..1000000`);
      per_user[k] = pu[k];
    }
  }
  return { schema: 1, call_sites, traps, per_user };
}

// src/engine/index.ts
var DEFAULTS = assumptions_default_default;
var DEFAULT_TIERS = DEFAULTS.tiers.value;
var KEYS2 = Object.keys(DEFAULTS).filter((k) => k !== "tiers");
var TRIGGER_KEY = {
  per_message: "messages_per_active_user_per_day",
  per_keystroke: "messages_per_active_user_per_day",
  per_page_view: "page_views_per_active_user_per_day",
  per_render: "page_views_per_active_user_per_day",
  per_poll: "polls_per_active_user_per_day",
  per_cron_run: "cron_runs_per_active_user_per_day",
  per_webhook: "webhooks_per_active_user_per_day",
  per_signup: "signups_per_active_user_per_day"
};
var cmp3 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var r6 = (x) => Math.round(x * 1e6) / 1e6;
var fmt = (x) => {
  const [i, f] = String(r6(x)).split(".");
  return i.replace(/\B(?=(\d{3})+$)/g, ",") + (f ? "." + f : "");
};
function resolveAssumptions(overrides, perUser) {
  const values = {};
  const sources = {};
  for (const k of KEYS2) values[k] = DEFAULTS[k].value;
  if (perUser.emails_per_month !== void 0) {
    values.emails_per_user_per_month = perUser.emails_per_month;
    sources.emails_per_user_per_month = "usage";
  }
  if (perUser.storage_mb !== void 0) {
    values.storage_mb_per_user = perUser.storage_mb;
    sources.storage_mb_per_user = "usage";
  }
  let tiers = DEFAULT_TIERS;
  Object.keys(overrides).sort(cmp3).forEach((k, i) => {
    if (k === "tiers") {
      const v2 = overrides[k];
      if (!Array.isArray(v2) || v2.length < 1 || v2.length > 6 || !v2.every((x) => Number.isInteger(x) && x >= 1 && x <= 1e9)) throw new Error("config.assumptions.tiers: must be a list of 1 to 6 whole numbers");
      tiers = [...new Set(v2)].sort((x, y) => x - y);
      return;
    }
    if (!KEYS2.includes(k)) throw new Error(`config.assumptions: key #${i} is not a known assumption`);
    const v = overrides[k];
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`config.assumptions.${k}: must be a number`);
    const ok = k === "daily_active_ratio" || k === "paying_user_ratio" ? v >= 0 && v <= 1 : k === "days_per_month" ? v > 0 && v <= 31 : k === "poll_seconds" ? v > 0 : v >= 0 && v <= 1e9;
    if (!ok) throw new Error(`config.assumptions.${k}: out of range`);
    values[k] = v;
    sources[k] = "config";
  });
  return { values, sources: Object.fromEntries(Object.entries(sources).sort((a, b) => cmp3(a[0], b[0]))), tiers };
}
function billJson(b) {
  return JSON.stringify(b, (_k, v) => typeof v === "number" ? r6(v) : v, 2) + "\n";
}
function calcBill(i) {
  const { detect: detect2, config, usage, pricing, llm, now } = i;
  const a = i.assumptions.values;
  const TIERS = i.assumptions.tiers;
  const sites = usage.call_sites;
  const llmStale = isStale(llm.fetched_at, now);
  const localUsed = i.local ? usedEntries(i.local, detect2.unknown_services.map((u) => u.hint)) : [];
  const cheapest = (svc, tin, tout) => {
    const prefix = svc === "openrouter" ? "~" : `~${svc}/`;
    let best = null, bestCost = Infinity, bestId = "";
    for (const id of Object.keys(llm.models)) {
      if (!id.startsWith(prefix)) continue;
      const m = llm.models[id], c = tin * m.input_per_1m + tout * m.output_per_1m;
      if (c < bestCost || c === bestCost && id < bestId) {
        best = { in: m.input_per_1m, out: m.output_per_1m };
        bestCost = c;
        bestId = id;
      }
    }
    return best;
  };
  const unverified = (svc) => detect2.flags.some((f) => f.type === "base_url" && f.service === svc && Object.hasOwn(config.providers, f.env) && config.providers[f.env] !== svc && config.providers[f.env] !== "openrouter");
  const tierRecs = (N, skip, cheap) => {
    const A = N * a.daily_active_ratio, d = a.days_per_month;
    const active = (id, site) => usage.traps.some((t, j) => j !== skip && t.id === id && t.call_site === site);
    const wide = (id) => active(id, null);
    const siteCalc = sites.map((s, k) => {
      const rate2 = a[TRIGGER_KEY[s.trigger]];
      let mult = 1;
      if (active("keystroke_llm_call", k)) mult *= a.chars_per_message;
      if (active("render_loop_llm_call", k)) mult *= a.render_loop_multiplier;
      if (active("no_prompt_cache", k)) mult *= a.no_prompt_cache_multiplier;
      if (active("aggressive_polling", k)) mult *= 60 / a.poll_seconds;
      const calls = A * d * rate2 * mult;
      const tin = (s.est_input_tokens ?? a.default_input_tokens) * (active("unbounded_history", k) ? a.history_input_multiplier : 1);
      const tout = s.est_output_tokens ?? a.default_output_tokens;
      return { rate: rate2, mult, calls, tin, tout };
    });
    let invocations = A * d * a.page_views_per_active_user_per_day;
    for (const c of siteCalc) invocations += c.calls;
    let egress = A * d * a.egress_mb_per_active_user_per_day / 1e3;
    if (wide("select_all_egress")) egress *= a.select_all_egress_multiplier;
    let db = N * a.db_mb_per_user / 1e3, storage = N * a.storage_mb_per_user / 1e3;
    if (wide("files_in_db")) {
      db += storage;
      storage = 0;
    }
    const units = {
      mau: N,
      db_gb: db,
      storage_gb: storage,
      egress_gb: egress,
      bandwidth_gb: A * d * a.page_views_per_active_user_per_day * a.bandwidth_mb_per_page_view / 1e3,
      function_invocations: invocations,
      function_gb_hours: 0,
      emails: N * a.emails_per_user_per_month,
      image_optimizations: wide("image_optimization_on_uploads") ? N * a.uploads_per_user_per_month * a.image_variants : 0
    };
    const out = [];
    for (const s of detect2.services) {
      if (Object.hasOwn(LLM_NAMES, s.id)) {
        sites.forEach((cs, k) => {
          if (cs.service !== s.id) return;
          const c = siteCalc[k];
          const modelId = Object.hasOwn(config.models, s.id) ? config.models[s.id] : null;
          const m = modelId !== null && Object.hasOwn(llm.models, modelId) ? llm.models[modelId] : null;
          const price2 = m && (cheap === k ? cheapest(s.id, c.tin, c.tout) ?? { in: m.input_per_1m, out: m.output_per_1m } : { in: m.input_per_1m, out: m.output_per_1m });
          const line = { service: s.id, label: `${LLM_NAMES[s.id]}: ${cs.feature}`, plan: modelId, amount: price2 ? c.calls * (c.tin * price2.in + c.tout * price2.out) / 1e6 : null };
          const ts = [...new Set(usage.traps.filter((t) => t.call_site === k).map((t) => t.id))];
          if (ts.length) line.traps = ts;
          if (!price2) line.unpriced = true;
          if (unverified(s.id)) line.unverified = true;
          if (llmStale) line.stale = true;
          out.push({ line, site: k, rate: c.rate, mult: c.mult, tin: c.tin, tout: c.tout });
        });
      } else if (Object.hasOwn(pricing.services, s.id)) {
        const svc = pricing.services[s.id];
        const orig = Object.hasOwn(config.plans, s.id) ? config.plans[s.id] : svc.default_plan;
        if (orig === "none") continue;
        let plan = orig, hops = 0;
        const over = (p2) => Object.entries(p2.included).some(([u, q]) => (units[u] ?? 0) > q);
        while (svc.plans[plan].overage === null && svc.plans[plan].upgrade_to && over(svc.plans[plan]) && hops++ <= Object.keys(svc.plans).length) plan = svc.plans[plan].upgrade_to;
        const p = svc.plans[plan];
        if (p.overage === null && !p.fee && over(p)) throw new Error(`pricing: ${s.id}.${plan} exceeded with no upgrade_to`);
        let amount;
        if (p.fee) amount = N * a.paying_user_ratio * (a.avg_payment_usd * p.fee.percent / 100 + p.fee.fixed_usd);
        else {
          let o = 0;
          if (p.overage) {
            for (const u of UNITS) if (u in p.overage) o += Math.max(0, (units[u] ?? 0) - (p.included[u] ?? 0)) * p.overage[u];
          }
          amount = p.base_monthly + Math.max(0, o - (p.usage_credit_usd ?? 0));
        }
        const line = { service: s.id, label: svc.name, plan, amount };
        if (plan !== orig) line.upgraded_from = orig;
        const ts = [...new Set(usage.traps.filter((t) => t.call_site === null && (s.id === "supabase" ? t.id === "select_all_egress" || t.id === "files_in_db" : s.id === "vercel" && t.id === "image_optimization_on_uploads")).map((t) => t.id))];
        if (ts.length) line.traps = ts;
        if (unverified(s.id)) line.unverified = true;
        if (isStale(svc.checked_at, now)) line.stale = true;
        out.push({ line, site: null, rate: 0, mult: 1, tin: 0, tout: 0 });
      }
    }
    for (const [id, e] of localUsed) {
      const noNumber = e.base_monthly === null && e.unit_price_usd === null;
      const amount = noNumber ? null : (e.base_monthly ?? 0) + (e.unit_price_usd === null ? 0 : N * e.units_per_user_per_month * e.unit_price_usd);
      const line = { service: id, label: e.name, plan: null, amount, unverified: true };
      if (noNumber) line.unpriced = true;
      if (isStale(e.checked_at, now)) line.stale = true;
      out.push({ line, site: null, rate: 0, mult: 1, tin: 0, tout: 0 });
    }
    return out;
  };
  const sum = (r) => r.reduce((s, x) => s + (x.line.amount ?? 0), 0);
  const full = TIERS.map((N) => tierRecs(N));
  const tiers = TIERS.map((N, t) => {
    const recs = full[t], lines = recs.map((r) => r.line);
    let big = null;
    lines.forEach((l, x) => {
      if (l.amount !== null && (big === null || l.amount > lines[big].amount)) big = x;
    });
    const ka = [`${fmt(N)} users/month, ${fmt(a.daily_active_ratio * 100)}% active daily`];
    if (big !== null) {
      const b = recs[big], s = b.line.service;
      if (b.site !== null) ka.push(`${sites[b.site].feature}: ${fmt(b.rate * b.mult)} calls/active user/day, ${fmt(b.tin)} in + ${fmt(b.tout)} out tokens`);
      else if (s === "supabase") ka.push(`${fmt(a.db_mb_per_user)} MB database/user, ${fmt(a.egress_mb_per_active_user_per_day)} MB egress/active user/day`);
      else if (s === "vercel") ka.push(`${fmt(a.page_views_per_active_user_per_day)} page views/active user/day`);
      else if (s === "clerk") ka.push("every user signs in each month");
      else if (s === "resend") ka.push(`${fmt(a.emails_per_user_per_month)} emails/user/month`);
      else if (s === "stripe") ka.push(`${fmt(a.paying_user_ratio * 100)}% paying, $${fmt(a.avg_payment_usd)} average payment`);
      else if (localUsed.some(([id]) => id === s)) {
        const e = i.local.services[s];
        ka.push(e.unit !== null ? `${e.name}: ${fmt(e.units_per_user_per_month)} ${e.unit}/user/month` : `${e.name}: flat plan price, usage not modelled`);
      }
      let m = b.site !== null ? big : null;
      if (m === null) recs.forEach((r, x) => {
        if (r.site !== null && r.line.amount !== null && (m === null || r.line.amount > lines[m].amount)) m = x;
      });
      if (m !== null) {
        const l = lines[m];
        ka.push(`model ${llm.models[l.plan].name.replace(/^[^:]*:\s*/, "")}${config.assumed.includes(`models.${l.service}`) ? " (assumed)" : ""}`);
      }
    }
    return { users: N, lines, total: sum(recs), biggest_line: big, key_assumptions: ka };
  });
  const traps = usage.traps.map((t, j) => {
    let savings = null;
    if (t.id !== "public_ai_endpoint_no_rate_limit") {
      savings = TIERS.map((N, ti) => {
        const alt = t.id === "top_model_for_trivial_task" ? tierRecs(N, void 0, t.call_site) : tierRecs(N, j);
        return Math.max(0, tiers[ti].total - sum(alt));
      });
    }
    return { id: t.id, call_site: t.call_site, fix: t.fix, savings_by_tier: savings };
  });
  const used = tiers[0].lines.length ? [...new Set(full.flatMap((r) => r.filter((x) => x.site === null).map((x) => x.line.service)))] : [];
  return {
    schema: 1,
    tiers,
    traps,
    prices_as_of: pricesAsOf({ llm, pricing, servicesUsed: detect2.services.map((s) => s.id).filter((id) => used.includes(id)), now, extra: localUsed.map(([id, e]) => ({ id, checked_at: e.checked_at })) }),
    assumptions: a,
    assumption_sources: i.assumptions.sources,
    assumed: [...config.assumed]
  };
}

// src/pricing/openrouter.ts
var URL2 = "https://openrouter.ai/api/v1/models";
function per1m(s) {
  if (typeof s !== "string" || s.trim() === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Number((n * 1e6).toPrecision(12));
}
function normalizeModels(body) {
  const data = body?.data;
  if (!Array.isArray(data)) throw new Error("openrouter: missing data array");
  const out = {};
  for (const m of data) {
    if (typeof m?.id !== "string") continue;
    const i = per1m(m.pricing?.prompt);
    const o = per1m(m.pricing?.completion);
    if (i === null || o === null) continue;
    out[m.id] = {
      name: typeof m.name === "string" ? m.name : m.id,
      context_length: Number.isFinite(m.context_length) ? m.context_length : 0,
      input_per_1m: i,
      output_per_1m: o
    };
  }
  if (Object.keys(out).length === 0) throw new Error("openrouter: no priced models");
  return out;
}
async function fetchOpenRouter(opts = {}) {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(URL2, { signal: AbortSignal.timeout(opts.timeoutMs ?? 1e4) });
  if (res.status !== 200) throw new Error(`openrouter: HTTP ${res.status}`);
  const models = normalizeModels(await res.json());
  return { source: "openrouter", fetched_at: (opts.now ?? /* @__PURE__ */ new Date()).toISOString().slice(0, 10), models };
}
async function getLlmPrices(opts) {
  try {
    return await fetchOpenRouter(opts);
  } catch {
    return { source: "snapshot", fetched_at: opts.snapshot.fetched_at, models: opts.snapshot.models };
  }
}
var MODEL_ALIASES = {
  "gpt-4o": "openai/gpt-4o",
  "gpt-4o-mini": "openai/gpt-4o-mini",
  "gemini-2.5-pro": "google/gemini-2.5-pro",
  "gemini-2.5-flash": "google/gemini-2.5-flash"
};
function resolveModel(prices, provider, modelId) {
  const cands = [modelId, provider ? `${provider}/${modelId}` : "", MODEL_ALIASES[modelId] ?? ""];
  for (const id of cands) {
    if (id && Object.hasOwn(prices.models, id)) return { id, ...prices.models[id] };
  }
  return null;
}

// src/questions/index.ts
var MAX_QUESTIONS = 4;
var MAX_OPTIONS = 4;
var RANK = { model: 0, base_url_provider: 1, plan_tier: 2 };
var CONF = { high: 0, medium: 1, low: 2 };
var cmp4 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function allQuestions(d, pricing, llm) {
  const qs = [];
  for (const s of d.services) {
    if (Object.hasOwn(LLM_NAMES, s.id)) {
      const name = LLM_NAMES[s.id];
      const toOpt = (id) => {
        const m = llm.models[id];
        return {
          value: id,
          label: m.name.replace(/^[^:]*:\s*/, ""),
          description: `$${m.input_per_1m} in / $${m.output_per_1m} out per 1M tokens`,
          input_per_1m: m.input_per_1m,
          output_per_1m: m.output_per_1m
        };
      };
      const hit = s.model ? resolveModel(llm, s.id === "openrouter" ? null : s.id, s.model) : null;
      const prefix = s.id === "openrouter" ? "~" : `~${s.id}/`;
      const ptrs = Object.keys(llm.models).filter((id) => id.startsWith(prefix) && id !== hit?.id).sort((a, b) => cmp4(llm.models[a].input_per_1m, llm.models[b].input_per_1m) || cmp4(llm.models[a].output_per_1m, llm.models[b].output_per_1m) || cmp4(a, b)).slice(0, MAX_OPTIONS - (hit ? 1 : 0));
      const options = [...hit ? [hit.id] : [], ...ptrs].map(toOpt);
      const note = s.model ? `found in code: ${s.model}${hit ? "" : " (no OpenRouter price)"}` : s.model_reason;
      qs.push({
        id: `models.${s.id}`,
        type: "model",
        service: s.id,
        prompt: `Which model does production use for ${name}?`,
        note,
        options,
        other: true,
        default: hit ? hit.id : ptrs.length ? ptrs[Math.floor((ptrs.length - 1) / 2)] : null,
        c: CONF[s.confidence]
      });
    }
    if (Object.hasOwn(pricing.services, s.id)) {
      const ps = pricing.services[s.id];
      const names = Object.keys(ps.plans);
      if (names.length > 1) qs.push({
        id: `plans.${s.id}`,
        type: "plan_tier",
        service: s.id,
        prompt: `Which ${ps.name} plan does production use?`,
        note: s.confidence === "low" ? `low confidence (${s.evidence.join(", ")})` : null,
        options: [
          ...names.map((p) => ({ value: p, label: p, description: `$${ps.plans[p].base_monthly}/month base` })),
          ...s.confidence === "low" ? [{ value: "none", label: "not used", description: "Drop this service from the bill" }] : []
        ],
        other: false,
        default: ps.default_plan,
        c: CONF[s.confidence]
      });
    }
  }
  for (const f of d.flags) {
    if (f.type !== "base_url" || !f.service || f.service === "openrouter") continue;
    const name = LLM_NAMES[f.service];
    qs.push({
      id: `providers.${f.env}`,
      type: "base_url_provider",
      service: f.service,
      prompt: `Which provider does ${f.env} point to in production?`,
      note: null,
      options: [{ value: f.service, label: name, description: `Direct ${name} API` }, { value: "openrouter", label: "OpenRouter", description: "Routed through OpenRouter" }],
      other: true,
      default: f.service,
      c: 0
    });
  }
  return qs.sort((a, b) => RANK[a.type] - RANK[b.type] || a.c - b.c || cmp4(a.id, b.id)).map(({ c: _c, ...q }) => q);
}
function pendingQuestions(qs, c) {
  return qs.filter((q) => getValue(c, q.id) === void 0 || c.assumed.includes(q.id));
}
function fillDefaults(c, qs) {
  const n = { ...c, models: { ...c.models }, plans: { ...c.plans }, providers: { ...c.providers }, assumed: [...c.assumed] };
  for (const q of qs) {
    if (q.default === null || getValue(c, q.id) !== void 0) continue;
    n[q.id.slice(0, q.id.indexOf("."))][q.id.slice(q.id.indexOf(".") + 1)] = q.default;
    n.assumed.push(q.id);
  }
  return n;
}

// src/render/index.ts
import { basename as basename4 } from "node:path";
var sep = (s) => s.replace(/\B(?=(\d{3})+$)/g, ",");
var fmtInt = (n) => sep(String(n));
function money(x) {
  if (x === null) return "n/a";
  if (x === 0) return "$0.00";
  if (x < 5e-3) return "<$0.01";
  const [i, f] = (Math.round(x * 100) / 100).toFixed(2).split(".");
  return "$" + sep(i) + "." + f;
}
function approx(x) {
  if (x >= 1) return "~$" + sep(String(Math.round(x)));
  return x > 0 ? "<$1" : "$0";
}
var esc = (s) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
var trunc = (s, n) => s.length <= n ? s : s.slice(0, Math.max(0, n - 3)) + "...";
function wrap(text, width, indent = 0, maxRows = Infinity) {
  const rows = [];
  let cur = "";
  for (let word of text.split(/\s+/).filter(Boolean)) {
    for (; ; ) {
      const room = rows.length ? width - indent : width;
      if (!cur) {
        if (word.length <= room) {
          cur = word;
          break;
        }
        rows.push(word.slice(0, room));
        word = word.slice(room);
      } else if (cur.length + 1 + word.length <= room) {
        cur += " " + word;
        break;
      } else {
        rows.push(cur);
        cur = "";
      }
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
function projectName(root) {
  const n = basename4(root).replace(/[^A-Za-z0-9 ._-]/g, "").trim().slice(0, 30).trim();
  return n || "my app";
}
var isObj5 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var fail5 = (path) => {
  throw new Error(`bill.json.${path}: invalid`);
};
var num2 = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
var str2 = (v, max) => typeof v === "string" && v.length <= max;
var DATE = /^\d{4}-\d{2}-\d{2}$/;
function parseBill(j) {
  if (!isObj5(j) || j.schema !== 1) return fail5("schema");
  if (!Array.isArray(j.tiers) || j.tiers.length < 1 || j.tiers.length > 20) return fail5("tiers");
  const tiers = j.tiers;
  tiers.forEach((t, i) => {
    const p = `tiers[${i}]`;
    if (!isObj5(t)) return fail5(p);
    if (!Number.isInteger(t.users) || t.users < 1) fail5(`${p}.users`);
    if (!num2(t.total)) fail5(`${p}.total`);
    if (!Array.isArray(t.lines) || t.lines.length > 200) return fail5(`${p}.lines`);
    if (!Array.isArray(t.key_assumptions) || t.key_assumptions.length < 1 || t.key_assumptions.length > 3 || !t.key_assumptions.every((s) => str2(s, 200))) fail5(`${p}.key_assumptions`);
    const first = tiers[0].lines;
    if (t.lines.length !== first.length) fail5(`${p}.lines`);
    t.lines.forEach((l, k) => {
      const q = `${p}.lines[${k}]`;
      if (!isObj5(l)) return fail5(q);
      if (!str2(l.service, 100)) fail5(`${q}.service`);
      if (!str2(l.label, 100)) fail5(`${q}.label`);
      if (l.plan !== null && !str2(l.plan, 100)) fail5(`${q}.plan`);
      if (l.amount !== null && !num2(l.amount)) fail5(`${q}.amount`);
      if (l.upgraded_from !== void 0 && !str2(l.upgraded_from, 100)) fail5(`${q}.upgraded_from`);
      for (const f of ["unpriced", "unverified", "stale"]) if (l[f] !== void 0 && l[f] !== true) fail5(`${q}.${f}`);
      if (l.traps !== void 0 && (!Array.isArray(l.traps) || l.traps.length > 20 || !l.traps.every((x) => TRAPS.includes(x)))) fail5(`${q}.traps`);
      const f0 = first[k];
      if (isObj5(f0) && (f0.service !== l.service || f0.label !== l.label)) fail5(`${q}.label`);
    });
  });
  if (!Array.isArray(j.traps) || j.traps.length > 100) return fail5("traps");
  j.traps.forEach((t, i) => {
    const p = `traps[${i}]`;
    if (!isObj5(t)) return fail5(p);
    if (!TRAPS.includes(t.id)) fail5(`${p}.id`);
    if (!str2(t.fix, 100)) fail5(`${p}.fix`);
    if (t.call_site !== null && !Number.isInteger(t.call_site)) fail5(`${p}.call_site`);
    const s = t.savings_by_tier;
    if (s !== null && (!Array.isArray(s) || s.length !== tiers.length || !s.every(num2))) fail5(`${p}.savings_by_tier`);
  });
  const pa = j.prices_as_of;
  if (!isObj5(pa) || !isObj5(pa.llm)) return fail5("prices_as_of");
  if (!str2(pa.llm.source, 40) || !str2(pa.llm.date, 10) || !DATE.test(pa.llm.date) || typeof pa.llm.stale !== "boolean") fail5("prices_as_of.llm");
  if (pa.other_oldest !== null && !(str2(pa.other_oldest, 10) && DATE.test(pa.other_oldest))) fail5("prices_as_of.other_oldest");
  for (const k of ["stale", "needs_check"]) if (!Array.isArray(pa[k]) || !pa[k].every((s) => str2(s, 100))) fail5(`prices_as_of.${k}`);
  if (!isObj5(j.assumptions) || !Object.values(j.assumptions).every((v) => typeof v === "number" && Number.isFinite(v))) fail5("assumptions");
  if (!isObj5(j.assumption_sources) || !Object.values(j.assumption_sources).every((v) => v === "usage" || v === "config")) fail5("assumption_sources");
  if (!Array.isArray(j.assumed) || !j.assumed.every((s) => str2(s, 100))) fail5("assumed");
  return j;
}
function defaultTier(bill) {
  const i = bill.tiers.findIndex((t) => t.users === 1e4);
  return i >= 0 ? i : bill.tiers.length - 1;
}
var FONT = "'Liberation Mono','Cousine','Courier New',monospace";
var BG = "#fbf8f1";
var INK = "#1f1f1f";
var DIM = "#6b6b6b";
var WARN = "#b45309";
var COLS = 54;
var MAX_ROWS = 8;
var marksOf = (l) => [
  ...l.upgraded_from ? [`(upgraded from ${l.upgraded_from})`] : [],
  ...l.unverified ? ["(unverified)"] : [],
  ...l.stale ? ["(price may be outdated)"] : [],
  ...l.unpriced ? ["(no price found)"] : []
];
function subRows(plan, marks) {
  const rest = marks.map((m) => " " + m).join("");
  if (plan.length + rest.length <= 50) return (plan + rest).trim() ? [(plan + rest).trim()] : [];
  const room = 50 - rest.length;
  return room >= 8 ? [trunc(plan, room) + rest] : wrap((plan + rest).trim(), 50);
}
function topFix(bill, t) {
  const sv = (tr) => tr.savings_by_tier?.[t];
  let best;
  for (const tr of bill.traps) if ((sv(tr) ?? 0) > (best ? sv(best) : 0)) best = tr;
  if (best) return { kind: "fix", fix: best.fix, saves: sv(best) };
  const risk = bill.traps.find((tr) => tr.savings_by_tier === null);
  return risk ? { kind: "risk", fix: risk.fix } : null;
}
function renderReceipt(bill, t, project, brand) {
  const tier = bill.tiers[t];
  const body = [];
  let y = 32, last = 0;
  const row = (size) => {
    last = y + (size === 20 ? 20 : 18);
    y += size === 20 ? 28 : 24;
    return last;
  };
  const text = (x, size, s, o = {}) => body.push(`<text x="${x}" y="${row(size)}" font-size="${size}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.dim ? ` fill="${DIM}"` : ""}>${esc(s)}</text>`);
  const rule = () => {
    body.push(`<line x1="32" y1="${y + 8}" x2="568" y2="${y + 8}" stroke="${DIM}" stroke-dasharray="4 4"/>`);
    y += 16;
  };
  const amountRow = (x, size, label, amount) => {
    const yy = row(size);
    body.push(`<text x="${x}" y="${yy}" font-size="${size}">${esc(label)}</text>`);
    body.push(`<text x="568" y="${yy}" font-size="${size}" text-anchor="end">${esc(amount)}</text>`);
    return yy;
  };
  const triangle = (base) => body.push(`<path d="M39,${base - 12} l7,12 h-14 z" fill="${WARN}"/><rect x="38" y="${base - 8}" width="2" height="4" fill="${BG}"/><rect x="38" y="${base - 3}" width="2" height="2" fill="${BG}"/>`);
  text(32, 20, `VIBE BILL \u2014 ${project}`);
  text(300, 16, "ESTIMATE", { anchor: "middle" });
  text(300, 16, `@ ${fmtInt(tier.users)} users / month`, { anchor: "middle" });
  rule();
  const order = tier.lines.map((l, i) => ({ l, i })).sort((a, b) => (b.l.amount ?? -1) - (a.l.amount ?? -1) || a.i - b.i);
  const items = [];
  const shown = order.length > MAX_ROWS ? order.slice(0, MAX_ROWS - 1) : order;
  for (const { l } of shown) items.push({ label: l.label, amount: l.amount, trap: !!l.traps?.length, plan: (l.plan ?? "").replace(/^~/, ""), marks: marksOf(l) });
  if (order.length > shown.length) {
    const rest = order.slice(shown.length).map((o) => o.l);
    const has = (f) => rest.some((l) => l[f]);
    items.push({
      label: `Other (${rest.length} lines)`,
      amount: rest.reduce((s, l) => s + (l.amount ?? 0), 0),
      trap: rest.some((l) => l.traps?.length),
      plan: "",
      marks: marksOf({ unverified: has("unverified") || void 0, stale: has("stale") || void 0, unpriced: has("unpriced") || void 0 })
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
  const fix = top?.kind === "fix" ? `Top fix: ${top.fix} \u2192 saves ${approx(top.saves)}/month` : top ? `Top risk: ${top.fix} (abuse cost not estimated)` : "";
  if (fix) wrap(fix, COLS, 2).forEach((s, i) => text(i ? 52 : 32, 16, s));
  wrap("Assumes: " + tier.key_assumptions.join(" \xB7 "), COLS, 2, 6).forEach((s, i) => text(i ? 52 : 32, 16, s));
  const pa = bill.prices_as_of;
  const src = pa.llm.source === "snapshot" ? "OpenRouter snapshot" : pa.llm.source === "openrouter" ? "OpenRouter live" : pa.llm.source;
  let prices = `LLM prices: ${src} ${pa.llm.date}${pa.llm.stale ? " (may be outdated)" : ""}`;
  if (pa.other_oldest) prices += ` \xB7 Other prices checked ${pa.other_oldest}${pa.stale.length ? " (some may be outdated)" : ""}`;
  wrap(prices, COLS, 2).forEach((s, i) => text(i ? 52 : 32, 16, s, { dim: true }));
  rule();
  text(300, 16, brand.repo_url, { anchor: "middle", dim: true });
  text(300, 16, brand.search, { anchor: "middle", dim: true });
  const h = last + 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${h}" viewBox="0 0 600 ${h}" font-family="${FONT}" fill="${INK}">
<rect width="600" height="${h}" fill="${BG}"/>
${body.join("\n")}
</svg>
`;
}
function renderHtml(svg, hasPng) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>vibe-bill receipt</title>
<style>body{margin:0;padding:16px;background:#eee;text-align:center}svg{max-width:100%;height:auto}a{display:block;margin:12px;font:16px sans-serif}</style></head>
<body>
${svg}${hasPng ? '<a href="receipt.png" download>Download receipt.png</a>\n' : ""}</body></html>
`;
}

// src/render/report.ts
var WHY = assumptions_default_default;
var r62 = (x) => Math.round(x * 1e6) / 1e6;
var fmt2 = (x) => {
  const [i, f] = String(r62(x)).split(".");
  return i.replace(/\B(?=(\d{3})+$)/g, ",") + (f ? "." + f : "");
};
var rate = (x) => x.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
var cmp5 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var md = (s) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[\\`*_\[\]<>|]/g, "\\$&");
var code = (s) => "`" + s.replace(/[`\u0000-\u001f\u007f]/g, "") + "`";
var CAVEAT = "LLM prices are OpenRouter list rates; direct-API discounts such as prompt caching or batch pricing are not included, so the actual bill may be lower.";
var CATALOGUE = {
  keystroke_llm_call: { title: "LLM call on every keystroke", why: "Every character typed sends a request, so one message costs dozens of calls." },
  render_loop_llm_call: { title: "LLM call inside a render loop", why: "The call runs each time the component re-renders, not once per user action." },
  unbounded_history: { title: "Whole chat history sent every turn", why: "Input tokens grow with every message, so long chats get expensive fast." },
  top_model_for_trivial_task: { title: "Top-tier model for a simple task", why: "A cheaper model of the same provider would do this job for a fraction of the price." },
  no_prompt_cache: { title: "Same request sent again and again", why: "Identical requests are recomputed instead of reusing an earlier answer." },
  public_ai_endpoint_no_rate_limit: { title: "Public AI endpoint without a rate limit", why: "Anyone can call it in a loop, and you pay for every call." },
  aggressive_polling: { title: "Polling an LLM on a short timer", why: "The call fires every few seconds whether or not anything changed." },
  image_optimization_on_uploads: { title: "Every upload resized into many variants", why: "Each uploaded image is billed once per generated size." },
  select_all_egress: { title: "Queries fetch whole tables", why: "Selecting every column and row moves far more data than the page shows." },
  files_in_db: { title: "Files stored in the database", why: "Database storage costs much more per GB than object storage." }
};
var NOT_MODELLED = {
  vercel: ["Active CPU ($0.128/hr)", "CDN requests ($2 per 1M)", "Extra seats ($20 each)", "Function GB-hours / provisioned memory"],
  supabase: ["Cached egress ($0.03/GB)", "MAU assumes Supabase Auth"],
  resend: ["Scale tiers", "Free plan 100 emails/day cap"],
  clerk: ["Business plan and add-ons"],
  stripe: ["International cards +1.5%", "Currency conversion +1%", "Billing 0.7%", "Disputes $15"]
};
function renderReport(i) {
  const { bill, usage, config, pricing, snap } = i;
  const t = i.tierIdx ?? defaultTier(bill);
  const tier = bill.tiers[t];
  const isLlm = (s) => Object.hasOwn(LLM_NAMES, s);
  const sav = (tr) => tr.savings_by_tier?.[t];
  const o = [];
  const h = (s) => o.push("", s, "");
  o.push(`# vibe-bill report: ${md(i.project)}`, "", `_Estimate, not an invoice. Shown tier: ${fmtInt(tier.users)} users/month._`);
  const per = tier.total / tier.users;
  const open = bill.traps.some((x) => x.id === "public_ai_endpoint_no_rate_limit");
  const best = Math.max(0, ...bill.traps.map((x) => sav(x) ?? 0));
  const partial = tier.lines.some((l) => l.amount === null);
  const base = per >= 1 || open ? "High" : per >= 0.1 || best > 0 ? "Medium" : "Low";
  const level = partial && base === "Low" ? "Unknown" : base;
  const tail = open ? "; one AI endpoint is public with no rate limit, so abuse cost has no ceiling." : best > 0 ? `; the biggest fixable trap saves ${approx(best)}/month.` : ".";
  h("## Verdict");
  o.push(`**${level} bill risk.** ${partial ? "At least " : "About "}${money(per)} per user per month at ${fmtInt(tier.users)} users${partial ? " (priced lines only; some lines have no price)" : ""}${tail}`);
  h("## Bill by tier");
  o.push(`| Service | ${bill.tiers.map((x) => `${fmtInt(x.users)} users`).join(" | ")} |`, `| --- | ${bill.tiers.map(() => "---").join(" | ")} |`);
  tier.lines.forEach((l, k) => {
    const cells = bill.tiers.map((x) => {
      const c = x.lines[k];
      let s = money(c.amount);
      if (c.unpriced) s += " (no price found)";
      else if (c.plan && !isLlm(c.service)) s += ` (${md(c.plan)})`;
      if (c.unverified) s += " (unverified)";
      if (c.stale) s += " (may be outdated)";
      return s;
    });
    o.push(`| ${md(l.label)}${l.traps?.length ? " \u26A0" : ""} | ${cells.join(" | ")} |`);
  });
  o.push(`| **Total** | ${bill.tiers.map((x) => money(x.total)).join(" | ")} |`);
  h("## Cost traps");
  if (!bill.traps.length) o.push("No cost traps were found in the code that was read.");
  const ranked = bill.traps.map((tr, k) => ({ tr, k })).sort((a, b) => (sav(b.tr) ?? -1) - (sav(a.tr) ?? -1) || a.k - b.k);
  ranked.forEach(({ tr }, n) => {
    const cat = CATALOGUE[tr.id];
    const cs = tr.call_site !== null ? usage.call_sites[tr.call_site] : void 0;
    const lower = /^[A-Z][a-z]/.test(cat.title) ? cat.title.charAt(0).toLowerCase() + cat.title.slice(1) : cat.title;
    const fix = tr.fix.replace(/[`\u0000-\u001f\u007f]/g, " ");
    const prompt = cs ? `In this app, the "${cs.feature}" ${LLM_NAMES[cs.service]} call has a cost problem: ${lower}. ${fix}. Make the smallest change that fixes it and keep everything else working.` : `This app has a cost problem: ${lower}. ${fix}. Make the smallest change that fixes it and keep everything else working.`;
    o.push(`### ${n + 1}. ${cat.title} (${cs ? md(cs.feature) : "whole app"})`, "", cat.why, "");
    o.push(tr.savings_by_tier === null ? "Saving not estimated: abuse cost is unbounded." : `Saves ${approx(sav(tr))}/month at ${fmtInt(tier.users)} users (${tr.savings_by_tier.map(approx).join(" / ")} at ${bill.tiers.map((x) => fmtInt(x.users)).join(" / ")}).`);
    o.push("", `**Fix:** ${md(tr.fix)}`, "", "Prompt for Claude Code:", "```text", prompt, "```", "");
  });
  if (bill.traps.length) o.pop();
  h("## Assumptions");
  const src = (k) => bill.assumption_sources[k] === "usage" ? "code analysis" : bill.assumption_sources[k] === "config" ? "config" : "default";
  o.push("| Assumption | Value | Source | Why |", "| --- | --- | --- | --- |");
  for (const [k, v] of Object.entries(bill.assumptions)) o.push(`| ${md(k)} | ${fmt2(v)} | ${src(k)} | ${md(Object.hasOwn(WHY, k) ? WHY[k].why : "")} |`);
  const choices = ["models", "plans", "providers"].flatMap((sec) => Object.entries(config[sec]).map(([k, v]) => [`${sec}.${k}`, v])).sort((a, b) => cmp5(a[0], b[0]));
  if (choices.length) {
    o.push("", "| Choice | Value | Source |", "| --- | --- | --- |");
    for (const [k, v] of choices) o.push(`| ${md(k)} | ${md(v)} | ${bill.assumed.includes(k) ? "assumed" : "answered"} |`);
  }
  o.push("", `> ${CAVEAT}`);
  h("## Prices");
  const llm = bill.prices_as_of.llm;
  o.push(`LLM: OpenRouter list rates (${md(llm.source === "snapshot" ? "snapshot" : llm.source === "openrouter" ? "live" : llm.source)}), fetched ${llm.date}${llm.stale ? " **may be outdated**" : ""}. https://openrouter.ai/models`);
  const plans = [...new Set(bill.tiers.flatMap((x) => x.lines.filter((l) => isLlm(l.service) && l.plan).map((l) => l.plan)))];
  if (plans.length) {
    const stored = llm.source === "snapshot" && llm.date === snap.fetched_at;
    o.push("", "| Model | $/1M input | $/1M output |", "| --- | --- | --- |");
    for (const p of plans) {
      const m = stored && Object.hasOwn(snap.models, p) ? snap.models[p] : null;
      o.push(`| ${md(p)} | ${m ? `$${m.input_per_1m}` : "rate not stored (live fetch)"} | ${m ? `$${m.output_per_1m}` : "rate not stored (live fetch)"} |`);
    }
  }
  const seen = /* @__PURE__ */ new Set();
  for (const l of tier.lines) {
    if (isLlm(l.service) || seen.has(l.service) || !Object.hasOwn(pricing.services, l.service)) continue;
    seen.add(l.service);
    const s = pricing.services[l.service];
    o.push("", `### ${md(s.name)}`, "", `Source: ${s.source_url}, checked ${s.checked_at}${bill.prices_as_of.needs_check.includes(l.service) || s.needs_check ? " **needs check**" : ""}${bill.prices_as_of.stale.includes(l.service) ? " **may be outdated**" : ""}`, "");
    const used = [...new Set(bill.tiers.flatMap((x) => x.lines.filter((y) => y.service === l.service && y.plan).map((y) => y.plan)))];
    for (const pn of used) {
      const p = Object.hasOwn(s.plans, pn) ? s.plans[pn] : null;
      if (!p) continue;
      const parts = [`base ${money(p.base_monthly)}/month`];
      if (p.usage_credit_usd) parts.push(`usage credit ${money(p.usage_credit_usd)}`);
      if (p.overage) parts.push("overage " + Object.entries(p.overage).map(([u, r]) => `${u} $${rate(r)}`).join(", "));
      if (p.fee) parts.push(`fee ${p.fee.percent}% + ${money(p.fee.fixed_usd)}`);
      o.push(`- ${md(pn)}: ${parts.join("; ")}`);
    }
  }
  const hints = i.detect.unknown_services.map((u) => u.hint);
  const local = i.local ? usedEntries(i.local, hints) : [];
  for (const [id, e] of local) {
    o.push("", `### ${md(e.name)}`, "", `Source: <${e.source_url}>, checked ${e.checked_at} **unverified** (found by web search at run time, not reviewed)${bill.prices_as_of.stale.includes(id) ? " **may be outdated**" : ""}`, "");
    if (e.unit !== null) o.push(`- $${rate(e.unit_price_usd)} per ${md(e.unit)} x ${fmt2(e.units_per_user_per_month)} ${md(e.unit)}/user/month`);
    if (e.base_monthly !== null) o.push(`- base ${money(e.base_monthly)}/month`);
    o.push("- Free tiers and included quotas are not applied.");
  }
  if (bill.tiers.some((x) => x.lines.some((l) => l.unverified && (isLlm(l.service) || Object.hasOwn(pricing.services, l.service))))) o.push("", "Lines marked unverified go through a base URL whose provider is not the service's own API.");
  h("## Not modelled");
  const svcs = [...new Set(tier.lines.map((l) => l.service))].filter((s) => Object.hasOwn(NOT_MODELLED, s));
  if (!svcs.length) o.push("Nothing known for these services.");
  svcs.forEach((s, n) => {
    if (n) o.push("");
    o.push(`**${md(pricing.services[s]?.name ?? s)}**`, ...NOT_MODELLED[s].map((x) => `- ${md(x)}`));
  });
  h("## What this estimate can't know");
  o.push("- Real traffic: user counts and usage per user are assumptions.", "- Negotiated discounts.", "- Free credits and startup programs.", "- Taxes.", "- Services that were not detected.");
  const unpriced = hints.filter((h2) => !local.some(([, e]) => e.hints.includes(h2)));
  if (unpriced.length) o.push("", "Detected but not priced: " + unpriced.map((h2) => code(h2)).join(", "));
  h("## Technical notes");
  o.push("| # | Feature | Service | Trigger | Location |", "| --- | --- | --- | --- | --- |");
  usage.call_sites.forEach((c, k) => o.push(`| ${k + 1} | ${md(c.feature)} | ${md(LLM_NAMES[c.service] ?? c.service)} | ${md(c.trigger)} | ${c.file ? code(c.line ? `${c.file}:${c.line}` : c.file) : "unknown"} |`));
  if (bill.traps.length) o.push("");
  for (const tr of bill.traps) o.push(`- ${md(tr.id)} \u2192 ${tr.call_site === null ? "whole app" : `call site #${tr.call_site + 1}`}`);
  return o.join("\n") + "\n";
}

// src/render/png.ts
import { readFileSync as readFileSync5 } from "node:fs";

// node_modules/@resvg/resvg-wasm/index.mjs
var wasm;
var heap = new Array(128).fill(void 0);
heap.push(void 0, null, true, false);
var heap_next = heap.length;
function addHeapObject(obj) {
  if (heap_next === heap.length)
    heap.push(heap.length + 1);
  const idx = heap_next;
  heap_next = heap[idx];
  heap[idx] = obj;
  return idx;
}
function getObject(idx) {
  return heap[idx];
}
function dropObject(idx) {
  if (idx < 132)
    return;
  heap[idx] = heap_next;
  heap_next = idx;
}
function takeObject(idx) {
  const ret = getObject(idx);
  dropObject(idx);
  return ret;
}
var WASM_VECTOR_LEN = 0;
var cachedUint8Memory0 = null;
function getUint8Memory0() {
  if (cachedUint8Memory0 === null || cachedUint8Memory0.byteLength === 0) {
    cachedUint8Memory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8Memory0;
}
var cachedTextEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder("utf-8") : { encode: () => {
  throw Error("TextEncoder not available");
} };
var encodeString = typeof cachedTextEncoder.encodeInto === "function" ? function(arg, view) {
  return cachedTextEncoder.encodeInto(arg, view);
} : function(arg, view) {
  const buf = cachedTextEncoder.encode(arg);
  view.set(buf);
  return {
    read: arg.length,
    written: buf.length
  };
};
function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === void 0) {
    const buf = cachedTextEncoder.encode(arg);
    const ptr2 = malloc(buf.length, 1) >>> 0;
    getUint8Memory0().subarray(ptr2, ptr2 + buf.length).set(buf);
    WASM_VECTOR_LEN = buf.length;
    return ptr2;
  }
  let len = arg.length;
  let ptr = malloc(len, 1) >>> 0;
  const mem = getUint8Memory0();
  let offset = 0;
  for (; offset < len; offset++) {
    const code2 = arg.charCodeAt(offset);
    if (code2 > 127)
      break;
    mem[ptr + offset] = code2;
  }
  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset);
    }
    ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
    const view = getUint8Memory0().subarray(ptr + offset, ptr + len);
    const ret = encodeString(arg, view);
    offset += ret.written;
    ptr = realloc(ptr, len, offset, 1) >>> 0;
  }
  WASM_VECTOR_LEN = offset;
  return ptr;
}
function isLikeNone(x) {
  return x === void 0 || x === null;
}
var cachedInt32Memory0 = null;
function getInt32Memory0() {
  if (cachedInt32Memory0 === null || cachedInt32Memory0.byteLength === 0) {
    cachedInt32Memory0 = new Int32Array(wasm.memory.buffer);
  }
  return cachedInt32Memory0;
}
var cachedTextDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }) : { decode: () => {
  throw Error("TextDecoder not available");
} };
if (typeof TextDecoder !== "undefined") {
  cachedTextDecoder.decode();
}
function getStringFromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return cachedTextDecoder.decode(getUint8Memory0().subarray(ptr, ptr + len));
}
function _assertClass(instance, klass) {
  if (!(instance instanceof klass)) {
    throw new Error(`expected instance of ${klass.name}`);
  }
  return instance.ptr;
}
function handleError(f, args) {
  try {
    return f.apply(this, args);
  } catch (e) {
    wasm.__wbindgen_exn_store(addHeapObject(e));
  }
}
var BBoxFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_bbox_free(ptr >>> 0));
var BBox = class _BBox {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_BBox.prototype);
    obj.__wbg_ptr = ptr;
    BBoxFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    BBoxFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_bbox_free(ptr);
  }
  /**
  * @returns {number}
  */
  get x() {
    const ret = wasm.__wbg_get_bbox_x(this.__wbg_ptr);
    return ret;
  }
  /**
  * @param {number} arg0
  */
  set x(arg0) {
    wasm.__wbg_set_bbox_x(this.__wbg_ptr, arg0);
  }
  /**
  * @returns {number}
  */
  get y() {
    const ret = wasm.__wbg_get_bbox_y(this.__wbg_ptr);
    return ret;
  }
  /**
  * @param {number} arg0
  */
  set y(arg0) {
    wasm.__wbg_set_bbox_y(this.__wbg_ptr, arg0);
  }
  /**
  * @returns {number}
  */
  get width() {
    const ret = wasm.__wbg_get_bbox_width(this.__wbg_ptr);
    return ret;
  }
  /**
  * @param {number} arg0
  */
  set width(arg0) {
    wasm.__wbg_set_bbox_width(this.__wbg_ptr, arg0);
  }
  /**
  * @returns {number}
  */
  get height() {
    const ret = wasm.__wbg_get_bbox_height(this.__wbg_ptr);
    return ret;
  }
  /**
  * @param {number} arg0
  */
  set height(arg0) {
    wasm.__wbg_set_bbox_height(this.__wbg_ptr, arg0);
  }
};
var RenderedImageFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_renderedimage_free(ptr >>> 0));
var RenderedImage = class _RenderedImage {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RenderedImage.prototype);
    obj.__wbg_ptr = ptr;
    RenderedImageFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RenderedImageFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_renderedimage_free(ptr);
  }
  /**
  * Get the PNG width
  * @returns {number}
  */
  get width() {
    const ret = wasm.renderedimage_width(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * Get the PNG height
  * @returns {number}
  */
  get height() {
    const ret = wasm.renderedimage_height(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * Write the image data to Uint8Array
  * @returns {Uint8Array}
  */
  asPng() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.renderedimage_asPng(retptr, this.__wbg_ptr);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      var r2 = getInt32Memory0()[retptr / 4 + 2];
      if (r2) {
        throw takeObject(r1);
      }
      return takeObject(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * Get the RGBA pixels of the image
  * @returns {Uint8Array}
  */
  get pixels() {
    const ret = wasm.renderedimage_pixels(this.__wbg_ptr);
    return takeObject(ret);
  }
};
var ResvgFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_resvg_free(ptr >>> 0));
var Resvg = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    ResvgFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_resvg_free(ptr);
  }
  /**
  * @param {Uint8Array | string} svg
  * @param {string | undefined} [options]
  * @param {Array<any> | undefined} [custom_font_buffers]
  */
  constructor(svg, options, custom_font_buffers) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      var ptr0 = isLikeNone(options) ? 0 : passStringToWasm0(options, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      var len0 = WASM_VECTOR_LEN;
      wasm.resvg_new(retptr, addHeapObject(svg), ptr0, len0, isLikeNone(custom_font_buffers) ? 0 : addHeapObject(custom_font_buffers));
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      var r2 = getInt32Memory0()[retptr / 4 + 2];
      if (r2) {
        throw takeObject(r1);
      }
      this.__wbg_ptr = r0 >>> 0;
      return this;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * Get the SVG width
  * @returns {number}
  */
  get width() {
    const ret = wasm.resvg_width(this.__wbg_ptr);
    return ret;
  }
  /**
  * Get the SVG height
  * @returns {number}
  */
  get height() {
    const ret = wasm.resvg_height(this.__wbg_ptr);
    return ret;
  }
  /**
  * Renders an SVG in Wasm
  * @returns {RenderedImage}
  */
  render() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.resvg_render(retptr, this.__wbg_ptr);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      var r2 = getInt32Memory0()[retptr / 4 + 2];
      if (r2) {
        throw takeObject(r1);
      }
      return RenderedImage.__wrap(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * Output usvg-simplified SVG string
  * @returns {string}
  */
  toString() {
    let deferred1_0;
    let deferred1_1;
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.resvg_toString(retptr, this.__wbg_ptr);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      deferred1_0 = r0;
      deferred1_1 = r1;
      return getStringFromWasm0(r0, r1);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  /**
  * Calculate a maximum bounding box of all visible elements in this SVG.
  *
  * Note: path bounding box are approx values.
  * @returns {BBox | undefined}
  */
  innerBBox() {
    const ret = wasm.resvg_innerBBox(this.__wbg_ptr);
    return ret === 0 ? void 0 : BBox.__wrap(ret);
  }
  /**
  * Calculate a maximum bounding box of all visible elements in this SVG.
  * This will first apply transform.
  * Similar to `SVGGraphicsElement.getBBox()` DOM API.
  * @returns {BBox | undefined}
  */
  getBBox() {
    const ret = wasm.resvg_getBBox(this.__wbg_ptr);
    return ret === 0 ? void 0 : BBox.__wrap(ret);
  }
  /**
  * Use a given `BBox` to crop the svg. Currently this method simply changes
  * the viewbox/size of the svg and do not move the elements for simplicity
  * @param {BBox} bbox
  */
  cropByBBox(bbox) {
    _assertClass(bbox, BBox);
    wasm.resvg_cropByBBox(this.__wbg_ptr, bbox.__wbg_ptr);
  }
  /**
  * @returns {Array<any>}
  */
  imagesToResolve() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.resvg_imagesToResolve(retptr, this.__wbg_ptr);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      var r2 = getInt32Memory0()[retptr / 4 + 2];
      if (r2) {
        throw takeObject(r1);
      }
      return takeObject(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {string} href
  * @param {Uint8Array} buffer
  */
  resolveImage(href, buffer) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passStringToWasm0(href, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len0 = WASM_VECTOR_LEN;
      wasm.resvg_resolveImage(retptr, this.__wbg_ptr, ptr0, len0, addHeapObject(buffer));
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      if (r1) {
        throw takeObject(r0);
      }
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
};
async function __wbg_load(module, imports) {
  if (typeof Response === "function" && module instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === "function") {
      try {
        return await WebAssembly.instantiateStreaming(module, imports);
      } catch (e) {
        if (module.headers.get("Content-Type") != "application/wasm") {
          console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
        } else {
          throw e;
        }
      }
    }
    const bytes = await module.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    const instance = await WebAssembly.instantiate(module, imports);
    if (instance instanceof WebAssembly.Instance) {
      return { instance, module };
    } else {
      return instance;
    }
  }
}
function __wbg_get_imports() {
  const imports = {};
  imports.wbg = {};
  imports.wbg.__wbg_new_28c511d9baebfa89 = function(arg0, arg1) {
    const ret = new Error(getStringFromWasm0(arg0, arg1));
    return addHeapObject(ret);
  };
  imports.wbg.__wbindgen_memory = function() {
    const ret = wasm.memory;
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_buffer_12d079cc21e14bdb = function(arg0) {
    const ret = getObject(arg0).buffer;
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_newwithbyteoffsetandlength_aa4a17c33a06e5cb = function(arg0, arg1, arg2) {
    const ret = new Uint8Array(getObject(arg0), arg1 >>> 0, arg2 >>> 0);
    return addHeapObject(ret);
  };
  imports.wbg.__wbindgen_object_drop_ref = function(arg0) {
    takeObject(arg0);
  };
  imports.wbg.__wbg_new_63b92bc8671ed464 = function(arg0) {
    const ret = new Uint8Array(getObject(arg0));
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_values_839f3396d5aac002 = function(arg0) {
    const ret = getObject(arg0).values();
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_next_196c84450b364254 = function() {
    return handleError(function(arg0) {
      const ret = getObject(arg0).next();
      return addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_done_298b57d23c0fc80c = function(arg0) {
    const ret = getObject(arg0).done;
    return ret;
  };
  imports.wbg.__wbg_value_d93c65011f51a456 = function(arg0) {
    const ret = getObject(arg0).value;
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_instanceof_Uint8Array_2b3bbecd033d19f6 = function(arg0) {
    let result;
    try {
      result = getObject(arg0) instanceof Uint8Array;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbindgen_string_get = function(arg0, arg1) {
    const obj = getObject(arg1);
    const ret = typeof obj === "string" ? obj : void 0;
    var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len1;
    getInt32Memory0()[arg0 / 4 + 0] = ptr1;
  };
  imports.wbg.__wbg_new_16b304a2cfa7ff4a = function() {
    const ret = new Array();
    return addHeapObject(ret);
  };
  imports.wbg.__wbindgen_string_new = function(arg0, arg1) {
    const ret = getStringFromWasm0(arg0, arg1);
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_push_a5b05aedc7234f9f = function(arg0, arg1) {
    const ret = getObject(arg0).push(getObject(arg1));
    return ret;
  };
  imports.wbg.__wbg_length_c20a40f15020d68a = function(arg0) {
    const ret = getObject(arg0).length;
    return ret;
  };
  imports.wbg.__wbg_set_a47bac70306a19a7 = function(arg0, arg1, arg2) {
    getObject(arg0).set(getObject(arg1), arg2 >>> 0);
  };
  imports.wbg.__wbindgen_throw = function(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
  };
  return imports;
}
function __wbg_init_memory(imports, maybe_memory) {
}
function __wbg_finalize_init(instance, module) {
  wasm = instance.exports;
  __wbg_init.__wbindgen_wasm_module = module;
  cachedInt32Memory0 = null;
  cachedUint8Memory0 = null;
  return wasm;
}
async function __wbg_init(input) {
  if (wasm !== void 0)
    return wasm;
  if (typeof input === "undefined") {
    input = new URL("index_bg.wasm", void 0);
  }
  const imports = __wbg_get_imports();
  if (typeof input === "string" || typeof Request === "function" && input instanceof Request || typeof URL === "function" && input instanceof URL) {
    input = fetch(input);
  }
  __wbg_init_memory(imports);
  const { instance, module } = await __wbg_load(await input, imports);
  return __wbg_finalize_init(instance, module);
}
var dist_default = __wbg_init;
var initialized = false;
var initWasm = async (module_or_path) => {
  if (initialized) {
    throw new Error("Already initialized. The `initWasm()` function can be used only once.");
  }
  await dist_default(await module_or_path);
  initialized = true;
};
var Resvg2 = class extends Resvg {
  /**
   * @param {Uint8Array | string} svg
   * @param {ResvgRenderOptions | undefined} options
   */
  constructor(svg, options) {
    if (!initialized)
      throw new Error("Wasm has not been initialized. Call `initWasm()` function.");
    const font = options?.font;
    if (!!font && isCustomFontsOptions(font)) {
      const serializableOptions = {
        ...options,
        font: {
          ...font,
          fontBuffers: void 0
        }
      };
      super(svg, JSON.stringify(serializableOptions), font.fontBuffers);
    } else {
      super(svg, JSON.stringify(options));
    }
  }
};
function isCustomFontsOptions(value) {
  return Object.prototype.hasOwnProperty.call(value, "fontBuffers");
}

// src/render/png.ts
var here = (bundled, src) => new URL(true ? bundled : src, import.meta.url);
var ready;
function loadPng() {
  return ready ??= (async () => {
    await initWasm(readFileSync5(here("./resvg.wasm", "../../node_modules/@resvg/resvg-wasm/index_bg.wasm")));
    const ttf = new Uint8Array(readFileSync5(here("./LiberationMono-Regular.ttf", "../../fonts/LiberationMono-Regular.ttf")));
    return (svg) => new Resvg2(svg, {
      fitTo: { mode: "width", value: 1200 },
      font: { fontBuffers: [ttf], loadSystemFonts: false, defaultFontFamily: "Liberation Mono" }
    }).render().asPng();
  })();
}

// data/brand.json
var brand_default = { repo_url: "github.com/globalmpc/vibe-bill", search: 'search "vibe-bill" on GitHub' };

// data/pricing.json
var pricing_default = {
  schema: 1,
  services: {
    supabase: {
      name: "Supabase",
      source_url: "https://supabase.com/pricing",
      checked_at: "2026-11-11",
      plans: {
        free: {
          base_monthly: 0,
          included: { mau: 5e4, db_gb: 0.5, egress_gb: 5, storage_gb: 1 },
          overage: null,
          upgrade_to: "pro"
        },
        pro: {
          base_monthly: 25,
          included: { mau: 1e5, db_gb: 8, egress_gb: 250, storage_gb: 100 },
          overage: { mau: 325e-5, db_gb: 0.125, egress_gb: 0.09, storage_gb: 0.0213 }
        }
      },
      default_plan: "free",
      needs_check: true
    },
    vercel: {
      name: "Vercel",
      source_url: "https://vercel.com/docs/pricing",
      checked_at: "2026-11-11",
      plans: {
        hobby: {
          base_monthly: 0,
          included: { bandwidth_gb: 100, function_invocations: 1e6, function_gb_hours: 360, image_optimizations: 5e3 },
          overage: null,
          upgrade_to: "pro"
        },
        pro: {
          base_monthly: 20,
          usage_credit_usd: 20,
          included: {},
          overage: { bandwidth_gb: 0.15, function_invocations: 6e-7, function_gb_hours: 0.0106, image_optimizations: 5e-5 }
        }
      },
      default_plan: "hobby",
      needs_check: true
    },
    clerk: {
      name: "Clerk",
      source_url: "https://clerk.com/pricing",
      checked_at: "2026-11-11",
      plans: {
        hobby: {
          base_monthly: 0,
          included: { mau: 5e4 },
          overage: null,
          upgrade_to: "pro"
        },
        pro: {
          base_monthly: 25,
          included: { mau: 5e4 },
          overage: { mau: 0.02 }
        }
      },
      default_plan: "hobby",
      needs_check: false
    },
    resend: {
      name: "Resend",
      source_url: "https://resend.com/pricing",
      checked_at: "2026-11-11",
      plans: {
        free: {
          base_monthly: 0,
          included: { emails: 3e3 },
          overage: null,
          upgrade_to: "pro"
        },
        pro: {
          base_monthly: 20,
          included: { emails: 5e4 },
          overage: { emails: 9e-4 }
        }
      },
      default_plan: "free",
      needs_check: true
    },
    stripe: {
      name: "Stripe",
      source_url: "https://stripe.com/pricing",
      checked_at: "2026-11-11",
      plans: {
        standard: {
          base_monthly: 0,
          included: {},
          overage: null,
          fee: { percent: 2.9, fixed_usd: 0.3 }
        }
      },
      default_plan: "standard",
      needs_check: false
    }
  }
};

// data/openrouter-snapshot.json
var openrouter_snapshot_default = {
  schema: 1,
  source: "openrouter",
  fetched_at: "2026-11-11",
  models: {
    "aion-labs/aion-2.0": {
      name: "AionLabs: Aion-2.0",
      context_length: 131072,
      input_per_1m: 0.8,
      output_per_1m: 1.6
    },
    "aion-labs/aion-3.0": {
      name: "AionLabs: Aion-3.0",
      context_length: 131072,
      input_per_1m: 3,
      output_per_1m: 6
    },
    "aion-labs/aion-3.0-mini": {
      name: "AionLabs: Aion-3.0-Mini",
      context_length: 131072,
      input_per_1m: 0.7,
      output_per_1m: 1.4
    },
    "aion-labs/aion-3.5": {
      name: "AionLabs: Aion 3.5",
      context_length: 262144,
      input_per_1m: 3,
      output_per_1m: 6
    },
    "aion-labs/aion-3.5-mini": {
      name: "AionLabs: Aion 3.5 Mini",
      context_length: 262144,
      input_per_1m: 0.7,
      output_per_1m: 1.4
    },
    "aion-labs/aion-rp-llama-3.1-8b": {
      name: "AionLabs: Aion-RP 1.0 (8B)",
      context_length: 32768,
      input_per_1m: 0.8,
      output_per_1m: 1.6
    },
    "amazon/nova-2-lite-v1": {
      name: "Amazon: Nova 2 Lite",
      context_length: 1e6,
      input_per_1m: 0.3,
      output_per_1m: 2.5
    },
    "amazon/nova-lite-v1": {
      name: "Amazon: Nova Lite 1.0",
      context_length: 3e5,
      input_per_1m: 0.06,
      output_per_1m: 0.24
    },
    "amazon/nova-micro-v1": {
      name: "Amazon: Nova Micro 1.0",
      context_length: 128e3,
      input_per_1m: 0.035,
      output_per_1m: 0.14
    },
    "amazon/nova-premier-v1": {
      name: "Amazon: Nova Premier 1.0",
      context_length: 1e6,
      input_per_1m: 2.5,
      output_per_1m: 12.5
    },
    "amazon/nova-pro-v1": {
      name: "Amazon: Nova Pro 1.0",
      context_length: 3e5,
      input_per_1m: 0.8,
      output_per_1m: 3.2
    },
    "anthracite-org/magnum-v4-72b": {
      name: "Magnum v4 72B",
      context_length: 32768,
      input_per_1m: 2.5,
      output_per_1m: 5
    },
    "anthropic/claude-fable-5": {
      name: "Anthropic: Claude Fable 5",
      context_length: 1e6,
      input_per_1m: 10,
      output_per_1m: 50
    },
    "anthropic/claude-fable-5.1": {
      name: "Anthropic: Claude Fable 5.1",
      context_length: 1e6,
      input_per_1m: 10,
      output_per_1m: 50
    },
    "anthropic/claude-fable-5.1:batch": {
      name: "Anthropic: Claude Fable 5.1 (batch)",
      context_length: 1e6,
      input_per_1m: 5,
      output_per_1m: 25
    },
    "anthropic/claude-fable-5.2": {
      name: "Anthropic: Claude Fable 5.2",
      context_length: 1e6,
      input_per_1m: 8,
      output_per_1m: 40
    },
    "anthropic/claude-fable-5.2:batch": {
      name: "Anthropic: Claude Fable 5.2 (batch)",
      context_length: 1e6,
      input_per_1m: 4,
      output_per_1m: 20
    },
    "anthropic/claude-fable-5:batch": {
      name: "Anthropic: Claude Fable 5 (batch)",
      context_length: 1e6,
      input_per_1m: 5,
      output_per_1m: 25
    },
    "anthropic/claude-haiku-4.5": {
      name: "Anthropic: Claude Haiku 4.5",
      context_length: 2e5,
      input_per_1m: 1,
      output_per_1m: 5
    },
    "anthropic/claude-haiku-4.5:batch": {
      name: "Anthropic: Claude Haiku 4.5 (batch)",
      context_length: 2e5,
      input_per_1m: 0.5,
      output_per_1m: 2.5
    },
    "anthropic/claude-haiku-5.5": {
      name: "Anthropic: Claude Haiku 5.5",
      context_length: 1e6,
      input_per_1m: 0.1,
      output_per_1m: 0.5
    },
    "anthropic/claude-haiku-5.5:batch": {
      name: "Anthropic: Claude Haiku 5.5 (batch)",
      context_length: 1e6,
      input_per_1m: 0.05,
      output_per_1m: 0.25
    },
    "anthropic/claude-opus-4.1": {
      name: "Anthropic: Claude Opus 4.1",
      context_length: 2e5,
      input_per_1m: 15,
      output_per_1m: 75
    },
    "anthropic/claude-opus-4.1:batch": {
      name: "Anthropic: Claude Opus 4.1 (batch)",
      context_length: 2e5,
      input_per_1m: 7.5,
      output_per_1m: 37.5
    },
    "anthropic/claude-opus-4.5": {
      name: "Anthropic: Claude Opus 4.5",
      context_length: 2e5,
      input_per_1m: 5,
      output_per_1m: 25
    },
    "anthropic/claude-opus-4.5:batch": {
      name: "Anthropic: Claude Opus 4.5 (batch)",
      context_length: 2e5,
      input_per_1m: 2.5,
      output_per_1m: 12.5
    },
    "anthropic/claude-opus-4.6": {
      name: "Anthropic: Claude Opus 4.6",
      context_length: 1e6,
      input_per_1m: 5,
      output_per_1m: 25
    },
    "anthropic/claude-opus-4.6:batch": {
      name: "Anthropic: Claude Opus 4.6 (batch)",
      context_length: 1e6,
      input_per_1m: 2.5,
      output_per_1m: 12.5
    },
    "anthropic/claude-opus-4.7": {
      name: "Anthropic: Claude Opus 4.7",
      context_length: 1e6,
      input_per_1m: 5,
      output_per_1m: 25
    },
    "anthropic/claude-opus-4.7:batch": {
      name: "Anthropic: Claude Opus 4.7 (batch)",
      context_length: 1e6,
      input_per_1m: 2.5,
      output_per_1m: 12.5
    },
    "anthropic/claude-opus-4.8": {
      name: "Anthropic: Claude Opus 4.8",
      context_length: 1e6,
      input_per_1m: 5,
      output_per_1m: 25
    },
    "anthropic/claude-opus-4.8:batch": {
      name: "Anthropic: Claude Opus 4.8 (batch)",
      context_length: 1e6,
      input_per_1m: 2.5,
      output_per_1m: 12.5
    },
    "anthropic/claude-opus-5": {
      name: "Anthropic: Claude Opus 5",
      context_length: 1e6,
      input_per_1m: 5,
      output_per_1m: 25
    },
    "anthropic/claude-opus-5.5": {
      name: "Anthropic: Claude Opus 5.5",
      context_length: 1e6,
      input_per_1m: 4,
      output_per_1m: 20
    },
    "anthropic/claude-opus-5.5:batch": {
      name: "Anthropic: Claude Opus 5.5 (batch)",
      context_length: 1e6,
      input_per_1m: 2,
      output_per_1m: 10
    },
    "anthropic/claude-opus-5:batch": {
      name: "Anthropic: Claude Opus 5 (batch)",
      context_length: 1e6,
      input_per_1m: 2.5,
      output_per_1m: 12.5
    },
    "anthropic/claude-sonnet-4.5": {
      name: "Anthropic: Claude Sonnet 4.5",
      context_length: 1e6,
      input_per_1m: 3,
      output_per_1m: 15
    },
    "anthropic/claude-sonnet-4.5:batch": {
      name: "Anthropic: Claude Sonnet 4.5 (batch)",
      context_length: 1e6,
      input_per_1m: 1.5,
      output_per_1m: 7.5
    },
    "anthropic/claude-sonnet-4.6": {
      name: "Anthropic: Claude Sonnet 4.6",
      context_length: 1e6,
      input_per_1m: 3,
      output_per_1m: 15
    },
    "anthropic/claude-sonnet-4.6:batch": {
      name: "Anthropic: Claude Sonnet 4.6 (batch)",
      context_length: 1e6,
      input_per_1m: 1.5,
      output_per_1m: 7.5
    },
    "anthropic/claude-sonnet-5": {
      name: "Anthropic: Claude Sonnet 5",
      context_length: 1e6,
      input_per_1m: 2,
      output_per_1m: 10
    },
    "anthropic/claude-sonnet-5.5": {
      name: "Anthropic: Claude Sonnet 5.5",
      context_length: 1e6,
      input_per_1m: 2,
      output_per_1m: 10
    },
    "anthropic/claude-sonnet-5.5:batch": {
      name: "Anthropic: Claude Sonnet 5.5 (batch)",
      context_length: 1e6,
      input_per_1m: 1,
      output_per_1m: 5
    },
    "anthropic/claude-sonnet-5:batch": {
      name: "Anthropic: Claude Sonnet 5 (batch)",
      context_length: 1e6,
      input_per_1m: 1,
      output_per_1m: 5
    },
    "baidu/ernie-5.5-flash-preview:free": {
      name: "Baidu: ERNIE-5.5-Flash-Preview (free)",
      context_length: 1024e3,
      input_per_1m: 0,
      output_per_1m: 0
    },
    "baidu/ernie-light-dt-1.0-intl": {
      name: "Baidu: ERNIE-Light-DT-1.0",
      context_length: 1024e3,
      input_per_1m: 1.13,
      output_per_1m: 3.94
    },
    "bytedance-seed/seed-1.6": {
      name: "ByteDance Seed: Seed 1.6",
      context_length: 262144,
      input_per_1m: 0.25,
      output_per_1m: 2
    },
    "bytedance-seed/seed-1.6-flash": {
      name: "ByteDance Seed: Seed 1.6 Flash",
      context_length: 262144,
      input_per_1m: 0.075,
      output_per_1m: 0.3
    },
    "bytedance-seed/seed-2-1-turbo": {
      name: "ByteDance Seed: Seed 2.1 Turbo",
      context_length: 262144,
      input_per_1m: 0.5,
      output_per_1m: 2.5
    },
    "bytedance-seed/seed-2.0-code": {
      name: "ByteDance Seed: Seed-2.0-Code",
      context_length: 262144,
      input_per_1m: 0.5,
      output_per_1m: 3
    },
    "bytedance-seed/seed-2.0-lite": {
      name: "ByteDance Seed: Seed-2.0-Lite",
      context_length: 262144,
      input_per_1m: 0.25,
      output_per_1m: 2
    },
    "bytedance-seed/seed-2.0-mini": {
      name: "ByteDance Seed: Seed-2.0-Mini",
      context_length: 262144,
      input_per_1m: 0.1,
      output_per_1m: 0.4
    },
    "bytedance/ui-tars-1.5-7b": {
      name: "ByteDance: UI-TARS 7B ",
      context_length: 128e3,
      input_per_1m: 0.1,
      output_per_1m: 0.2
    },
    "cognitivecomputations/dolphin-mistral-24b-venice-edition": {
      name: "Venice: Uncensored",
      context_length: 128e3,
      input_per_1m: 0.2,
      output_per_1m: 0.9
    },
    "cohere/command-a": {
      name: "Cohere: Command A",
      context_length: 256e3,
      input_per_1m: 2.5,
      output_per_1m: 10
    },
    "cohere/command-a-plus": {
      name: "Cohere: Command A+",
      context_length: 192e3,
      input_per_1m: 0.3,
      output_per_1m: 1.5
    },
    "cohere/command-r-08-2024": {
      name: "Cohere: Command R (08-2024)",
      context_length: 128e3,
      input_per_1m: 0.15,
      output_per_1m: 0.6
    },
    "cohere/command-r-plus-08-2024": {
      name: "Cohere: Command R+ (08-2024)",
      context_length: 128e3,
      input_per_1m: 2.5,
      output_per_1m: 10
    },
    "cohere/command-r7b-12-2024": {
      name: "Cohere: Command R7B (12-2024)",
      context_length: 128e3,
      input_per_1m: 0.0375,
      output_per_1m: 0.15
    },
    "cohere/north-mini-code:free": {
      name: "Cohere: North Mini Code (free)",
      context_length: 256e3,
      input_per_1m: 0,
      output_per_1m: 0
    },
    "deepseek/deepseek-chat": {
      name: "DeepSeek: DeepSeek V3",
      context_length: 163840,
      input_per_1m: 0.32,
      output_per_1m: 0.89
    },
    "deepseek/deepseek-chat-v3-0324": {
      name: "DeepSeek: DeepSeek V3 0324",
      context_length: 163840,
      input_per_1m: 0.29,
      output_per_1m: 1.14
    },
    "deepseek/deepseek-chat-v3.1": {
      name: "DeepSeek: DeepSeek V3.1",
      context_length: 163840,
      input_per_1m: 0.25,
      output_per_1m: 0.95
    },
    "deepseek/deepseek-r1-0528": {
      name: "DeepSeek: R1 0528",
      context_length: 163840,
      input_per_1m: 0.5,
      output_per_1m: 2.15
    },
    "deepseek/deepseek-v3.1-terminus": {
      name: "DeepSeek: DeepSeek V3.1 Terminus",
      context_length: 163840,
      input_per_1m: 0.27,
      output_per_1m: 1
    },
    "deepseek/deepseek-v3.2": {
      name: "DeepSeek: DeepSeek V3.2",
      context_length: 163840,
      input_per_1m: 0.26,
      output_per_1m: 0.38
    },
    "deepseek/deepseek-v3.2-exp": {
      name: "DeepSeek: DeepSeek V3.2 Exp",
      context_length: 163840,
      input_per_1m: 0.27,
      output_per_1m: 0.41
    },
    "deepseek/deepseek-v4-flash": {
      name: "DeepSeek: DeepSeek V4 Flash 0423",
      context_length: 1048576,
      input_per_1m: 0.09,
      output_per_1m: 0.18
    },
    "deepseek/deepseek-v4-flash-0731": {
      name: "DeepSeek: DeepSeek V4 Flash 0731",
      context_length: 1048576,
      input_per_1m: 0.0434,
      output_per_1m: 0.3
    },
    "deepseek/deepseek-v4-flash-0731:batch": {
      name: "DeepSeek: DeepSeek V4 Flash 0731 (batch)",
      context_length: 1048576,
      input_per_1m: 0.048,
      output_per_1m: 0.144
    },
    "deepseek/deepseek-v4-flash-vision-exp": {
      name: "DeepSeek: DeepSeek V4 Flash Vision Exp",
      context_length: 1048576,
      input_per_1m: 0.44,
      output_per_1m: 1.32
    },
    "deepseek/deepseek-v4-pro": {
      name: "DeepSeek: DeepSeek V4 Pro 0423",
      context_length: 1048576,
      input_per_1m: 0.95526,
      output_per_1m: 1.91052
    },
    "deepseek/deepseek-v4-pro-0813": {
      name: "DeepSeek: DeepSeek V4 Pro 0813",
      context_length: 1048576,
      input_per_1m: 0.111,
      output_per_1m: 4.44
    },
    "deepseek/deepseek-v4.1-flash": {
      name: "DeepSeek: DeepSeek V4.1 Flash",
      context_length: 1048576,
      input_per_1m: 0.051,
      output_per_1m: 0.567
    },
    "deepseek/deepseek-v4.1-flash-1017": {
      name: "DeepSeek: DeepSeek V4.1 Flash 1017",
      context_length: 1048576,
      input_per_1m: 6e-3,
      output_per_1m: 0.5
    },
    "deepseek/deepseek-v4.1-flash-1017:batch": {
      name: "DeepSeek: DeepSeek V4.1 Flash 1017 (batch)",
      context_length: 1048576,
      input_per_1m: 0.011,
      output_per_1m: 0.2
    },
    "deepseek/deepseek-v4.1-flash:batch": {
      name: "DeepSeek: DeepSeek V4.1 Flash (batch)",
      context_length: 1048576,
      input_per_1m: 0.112,
      output_per_1m: 0.336
    },
    "dots-studio/dots-3-note-preview:free": {
      name: "Dots Studio: Dots3-Note Preview (free)",
      context_length: 512e3,
      input_per_1m: 0,
      output_per_1m: 0
    },
    "elorian/glimpse": {
      name: "Elorian: Glimpse",
      context_length: 262144,
      input_per_1m: 0.6,
      output_per_1m: 3
    },
    "fireworks/ember-1": {
      name: "Fireworks: Ember-1",
      context_length: 1048576,
      input_per_1m: 3,
      output_per_1m: 15
    },
    "google/gemini-2.5-flash": {
      name: "Google: Gemini 2.5 Flash",
      context_length: 1048576,
      input_per_1m: 0.3,
      output_per_1m: 2.5
    },
    "google/gemini-2.5-flash-image": {
      name: "Google: Nano Banana (Gemini 2.5 Flash Image)",
      context_length: 32768,
      input_per_1m: 0.3,
      output_per_1m: 2.5
    },
    "google/gemini-2.5-flash-lite": {
      name: "Google: Gemini 2.5 Flash Lite",
      context_length: 1048576,
      input_per_1m: 0.1,
      output_per_1m: 0.4
    },
    "google/gemini-2.5-pro": {
      name: "Google: Gemini 2.5 Pro",
      context_length: 1048576,
      input_per_1m: 1.25,
      output_per_1m: 10
    },
    "google/gemini-2.5-pro-preview": {
      name: "Google: Gemini 2.5 Pro Preview 06-05",
      context_length: 1048576,
      input_per_1m: 1.25,
      output_per_1m: 10
    },
    "google/gemini-3-flash-preview": {
      name: "Google: Gemini 3 Flash Preview",
      context_length: 1048576,
      input_per_1m: 0.5,
      output_per_1m: 3
    },
    "google/gemini-3-flash-preview:batch": {
      name: "Google: Gemini 3 Flash Preview (batch)",
      context_length: 1048576,
      input_per_1m: 0.25,
      output_per_1m: 1.5
    },
    "google/gemini-3-pro-image": {
      name: "Google: Nano Banana Pro (Gemini 3 Pro Image)",
      context_length: 131072,
      input_per_1m: 2,
      output_per_1m: 12
    },
    "google/gemini-3-pro-image-preview": {
      name: "Google: Nano Banana Pro (Gemini 3 Pro Image Preview)",
      context_length: 65536,
      input_per_1m: 2,
      output_per_1m: 12
    },
    "google/gemini-3.1-flash-image": {
      name: "Google: Nano Banana 2 (Gemini 3.1 Flash Image)",
      context_length: 131072,
      input_per_1m: 0.5,
      output_per_1m: 3
    },
    "google/gemini-3.1-flash-image-preview": {
      name: "Google: Nano Banana 2 (Gemini 3.1 Flash Image Preview)",
      context_length: 65536,
      input_per_1m: 0.5,
      output_per_1m: 3
    },
    "google/gemini-3.1-flash-lite": {
      name: "Google: Gemini 3.1 Flash Lite",
      context_length: 1048576,
      input_per_1m: 0.25,
      output_per_1m: 1.5
    },
    "google/gemini-3.1-flash-lite-image": {
      name: "Google: Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)",
      context_length: 65536,
      input_per_1m: 0.25,
      output_per_1m: 1.5
    },
    "google/gemini-3.1-flash-lite-preview": {
      name: "Google: Gemini 3.1 Flash Lite Preview",
      context_length: 1048576,
      input_per_1m: 0.25,
      output_per_1m: 1.5
    },
    "google/gemini-3.1-flash-lite:batch": {
      name: "Google: Gemini 3.1 Flash Lite (batch)",
      context_length: 1048576,
      input_per_1m: 0.125,
      output_per_1m: 0.75
    },
    "google/gemini-3.1-pro-preview": {
      name: "Google: Gemini 3.1 Pro Preview",
      context_length: 1048576,
      input_per_1m: 2,
      output_per_1m: 12
    },
    "google/gemini-3.1-pro-preview-customtools": {
      name: "Google: Gemini 3.1 Pro Preview Custom Tools",
      context_length: 1048576,
      input_per_1m: 2,
      output_per_1m: 12
    },
    "google/gemini-3.1-pro-preview:batch": {
      name: "Google: Gemini 3.1 Pro Preview (batch)",
      context_length: 1048576,
      input_per_1m: 1,
      output_per_1m: 6
    },
    "google/gemini-3.5-flash": {
      name: "Google: Gemini 3.5 Flash",
      context_length: 1048576,
      input_per_1m: 1.5,
      output_per_1m: 9
    },
    "google/gemini-3.5-flash-lite": {
      name: "Google: Gemini 3.5 Flash Lite",
      context_length: 1048576,
      input_per_1m: 0.3,
      output_per_1m: 2.5
    },
    "google/gemini-3.5-flash-lite:batch": {
      name: "Google: Gemini 3.5 Flash Lite (batch)",
      context_length: 1048576,
      input_per_1m: 0.15,
      output_per_1m: 1.25
    },
    "google/gemini-3.5-flash:batch": {
      name: "Google: Gemini 3.5 Flash (batch)",
      context_length: 1048576,
      input_per_1m: 0.75,
      output_per_1m: 4.5
    },
    "google/gemini-3.6-flash": {
      name: "Google: Gemini 3.6 Flash",
      context_length: 1048576,
      input_per_1m: 0.75,
      output_per_1m: 3.75
    },
    "google/gemini-3.6-flash:batch": {
      name: "Google: Gemini 3.6 Flash (batch)",
      context_length: 1048576,
      input_per_1m: 0.375,
      output_per_1m: 1.875
    },
    "google/gemini-3.7-flash": {
      name: "Google: Gemini 3.7 Flash",
      context_length: 1048576,
      input_per_1m: 0.75,
      output_per_1m: 3.75
    },
    "google/gemini-3.7-flash:batch": {
      name: "Google: Gemini 3.7 Flash (batch)",
      context_length: 1048576,
      input_per_1m: 0.375,
      output_per_1m: 1.875
    },
    "google/gemini-3.8-flash": {
      name: "Google: Gemini 3.8 Flash",
      context_length: 1048576,
      input_per_1m: 0.825,
      output_per_1m: 4.125
    },
    "google/gemini-3.8-flash:batch": {
      name: "Google: Gemini 3.8 Flash (batch)",
      context_length: 1048576,
      input_per_1m: 0.375,
      output_per_1m: 1.875
    },
    "google/gemini-4-argon": {
      name: "Google: Gemini 4 Argon",
      context_length: 1048576,
      input_per_1m: 2,
      output_per_1m: 10
    },
    "google/gemini-4-argon:batch": {
      name: "Google: Gemini 4 Argon (batch)",
      context_length: 1048576,
      input_per_1m: 1,
      output_per_1m: 5
    },
    "google/gemini-4-carbon": {
      name: "Google: Gemini 4 Carbon",
      context_length: 1048576,
      input_per_1m: 2,
      output_per_1m: 10
    },
    "google/gemini-4-carbon:batch": {
      name: "Google: Gemini 4 Carbon (batch)",
      context_length: 1048576,
      input_per_1m: 1,
      output_per_1m: 5
    },
    "google/gemini-nano-banana-2.1": {
      name: "Google: Nano Banana 2.1",
      context_length: 65536,
      input_per_1m: 1.5,
      output_per_1m: 7.5
    },
    "google/gemini-omni-1.1-flash": {
      name: "Google: Gemini Omni 1.1 Flash",
      context_length: 131072,
      input_per_1m: 1.5,
      output_per_1m: 9
    },
    "google/gemini-omni-1.2-flash": {
      name: "Google: Gemini Omni 1.2 Flash",
      context_length: 131072,
      input_per_1m: 1.5,
      output_per_1m: 9
    },
    "google/gemma-2-27b-it": {
      name: "Google: Gemma 2 27B",
      context_length: 8192,
      input_per_1m: 0.65,
      output_per_1m: 0.65
    },
    "google/gemma-3-12b-it": {
      name: "Google: Gemma 3 12B",
      context_length: 131072,
      input_per_1m: 0.05,
      output_per_1m: 0.15
    },
    "google/gemma-3-27b-it": {
      name: "Google: Gemma 3 27B",
      context_length: 131072,
      input_per_1m: 0.08,
      output_per_1m: 0.45
    },
    "google/gemma-3-4b-it": {
      name: "Google: Gemma 3 4B",
      context_length: 131072,
      input_per_1m: 0.05,
      output_per_1m: 0.1
    },
    "google/gemma-4-26b-a4b-it": {
      name: "Google: Gemma 4 26B A4B ",
      context_length: 262144,
      input_per_1m: 0.08,
      output_per_1m: 0.1
    },
    "google/gemma-4-26b-a4b-it:free": {
      name: "Google: Gemma 4 26B A4B  (free)",
      context_length: 262144,
      input_per_1m: 0,
      output_per_1m: 0
    },
    "google/gemma-4-31b-it": {
      name: "Google: Gemma 4 31B",
      context_length: 262144,
      input_per_1m: 0.2,
      output_per_1m: 0.4
    },
    "google/gemma-4-31b-it:free": {
      name: "Google: Gemma 4 31B (free)",
      context_length: 262144,
      input_per_1m: 0,
      output_per_1m: 0
    },
    "google/lyria-3-clip-preview": {
      name: "Google: Lyria 3 Clip Preview",
      context_length: 1048576,
      input_per_1m: 0,
      output_per_1m: 0
    },
    "google/lyria-3-pro-preview": {
      name: "Google: Lyria 3 Pro Preview",
      context_length: 1048576,
      input_per_1m: 0,
      output_per_1m: 0
    },
    "gryphe/mythomax-l2-13b": {
      name: "MythoMax 13B",
      context_length: 8192,
      input_per_1m: 0.08,
      output_per_1m: 0.11
    },
    "ibm-granite/granite-4.2-8b": {
      name: "IBM: Granite 4.2 8B",
      context_length: 131072,
      input_per_1m: 0.06,
      output_per_1m: 0.25
    },
    "inclusionai/ling-3.0-flash": {
      name: "inclusionAI: Ling 3.0 Flash",
      context_length: 262144,
      input_per_1m: 0.021,
      output_per_1m: 0.063
    },
    "inclusionai/ling-3.0-flash-vl": {
      name: "inclusionAI: Ling 3.0 Flash VL",
      context_length: 131072,
      input_per_1m: 0.06,
      output_per_1m: 0.18
    },
    "inclusionai/ling-3.0-tiny": {
      name: "inclusionAI: Ling 3.0 Tiny",
      context_length: 262144,
      input_per_1m: 0.015,
      output_per_1m: 0.045
    },
    "inclusionai/ling-3.1-flash": {
      name: "inclusionAI: Ling 3.1 Flash",
      context_length: 1e6,
      input_per_1m: 0.045,
      output_per_1m: 0.135
    },
    "inference-net/schematron-v2-small": {
      name: "Inference.net: Schematron V2 Small",
      context_length: 128e3,
      input_per_1m: 0.05,
      output_per_1m: 0.23
    },
    "inference-net/schematron-v2-turbo": {
      name: "Inference.net: Schematron V2 Turbo",
      context_length: 128e3,
      input_per_1m: 0.03,
      output_per_1m: 0.15
    },
    "kt/midm-k-3.0-pro": {
      name: "KT: Mi:dm K 3.0 Pro",
      context_length: 261795,
      input_per_1m: 0.2,
      output_per_1m: 0.8
    },
    "liquid/lfm-2.5-2.6b": {
      name: "LiquidAI: LFM2.5-2.6B",
      context_length: 128e3,
      input_per_1m: 0.35,
      output_per_1m: 0.5
    },
    "liquid/lfm-2.5-2.6b:free": {
      name: "LiquidAI: LFM2.5-2.6B (free)",
      context_length: 65536,
      input_per_1m: 0,
      output_per_1m: 0
    },
    "liquid/lfm-2.5-24b-a2b": {
      name: "LiquidAI: LFM2.5-24B-A2B",
      context_length: 128e3,
      input_per_1m: 0.05,
      output_per_1m: 0.7
    },
    "liquid/lfm-3-1.7b": {
      name: "LiquidAI: LFM3-1.7B",
      context_length: 262144,
      input_per_1m: 0.08,
      output_per_1m: 0.2
    },
    "liquid/lfm-3-1.7b:free": {
      name: "LiquidAI: LFM3-1.7B (free)",
      context_length: 262144,
      input_per_1m: 0,
      output_per_1m: 0
    },
    "mancer/weaver": {
      name: "Mancer: Weaver (alpha)",
      context_length: 8e3,
      input_per_1m: 0.3,
      output_per_1m: 0.5
    },
    "meituan/longcat-2.0": {
      name: "Meituan: LongCat 2.0",
      context_length: 1048756,
      input_per_1m: 0.3,
      output_per_1m: 1.2
    },
    "meta-llama/llama-3.1-70b-instruct": {
      name: "Meta: Llama 3.1 70B Instruct",
      context_length: 131072,
      input_per_1m: 0.72,
      output_per_1m: 0.72
    },
    "meta-llama/llama-3.1-8b-instruct": {
      name: "Meta: Llama 3.1 8B Instruct",
      context_length: 131072,
      input_per_1m: 0.02,
      output_per_1m: 0.04
    },
    "meta-llama/llama-3.2-1b-instruct": {
      name: "Meta: Llama 3.2 1B Instruct",
      context_length: 6e4,
      input_per_1m: 0.027,
      output_per_1m: 0.201
    },
    "meta-llama/llama-3.2-3b-instruct": {
      name: "Meta: Llama 3.2 3B Instruct",
      context_length: 131072,
      input_per_1m: 0.05,
      output_per_1m: 0.33
    },
    "meta-llama/llama-3.3-70b-instruct": {
      name: "Meta: Llama 3.3 70B Instruct",
      context_length: 131072,
      input_per_1m: 0.71,
      output_per_1m: 0.71
    },
    "meta-llama/llama-4-maverick": {
      name: "Meta: Llama 4 Maverick",
      context_length: 524288,
      input_per_1m: 0.35,
      output_per_1m: 1
    },
    "meta-llama/llama-4-scout": {
      name: "Meta: Llama 4 Scout",
      context_length: 1310720,
      input_per_1m: 0.1,
      output_per_1m: 0.3
    },
    "meta-llama/llama-guard-4-12b": {
      name: "Meta: Llama Guard 4 12B",
      context_length: 163840,
      input_per_1m: 0.18,
      output_per_1m: 0.18
    },
    "meta/muse-ember": {
      name: "Meta: Muse Ember",
      context_length: 1048576,
      input_per_1m: 0.1,
      output_per_1m: 0.5
    },
    "meta/muse-glimmer-30b": {
      name: "Meta: Muse Glimmer 30B",
      context_length: 131072,
      input_per_1m: 0.3,
      output_per_1m: 1.2
    },
    "meta/muse-glimmer-30b:batch": {
      name: "Meta: Muse Glimmer 30B (batch)",
      context_length: 131072,
      input_per_1m: 0.24,
      output_per_1m: 0.96
    },
    "meta/muse-spark-1.1": {
      name: "Meta: Muse Spark 1.1",
      context_length: 1048576,
      input_per_1m: 1.25,
      output_per_1m: 4.25
    },
    "meta/muse-spark-1.2": {
      name: "Meta: Muse Spark 1.2",
      context_length: 1048576,
      input_per_1m: 1.25,
      output_per_1m: 4.25
    },
    "meta/muse-spark-1.2-contributor": {
      name: "Meta: Muse Spark 1.2 Contributor",
      context_length: 1048576,
      input_per_1m: 0.1,
      output_per_1m: 0.2
    },
    "meta/muse-spark-1.3": {
      name: "Meta: Muse Spark 1.3",
      context_length: 1048576,
      input_per_1m: 1.25,
      output_per_1m: 4.25
    },
    "meta/muse-spark-1.3-contributor": {
      name: "Meta: Muse Spark 1.3 Contributor",
      context_length: 1048576,
      input_per_1m: 0.1,
      output_per_1m: 0.2
    },
    "meta/muse-spark-open": {
      name: "Meta: Muse Spark Open",
      context_length: 1048576,
      input_per_1m: 1.25,
      output_per_1m: 4.25
    },
    "meta/muse-wonder": {
      name: "Meta: Muse Wonder",
      context_length: 1048576,
      input_per_1m: 4,
      output_per_1m: 20
    },
    "microsoft/phi-4": {
      name: "Microsoft: Phi 4",
      context_length: 16384,
      input_per_1m: 0.07,
      output_per_1m: 0.14
    },
    "minimax/minimax-m2.5": {
      name: "MiniMax: MiniMax M2.5",
      context_length: 2e5,
      input_per_1m: 0.3,
      output_per_1m: 1.2
    },
    "minimax/minimax-m2.7": {
      name: "MiniMax: MiniMax M2.7",
      context_length: 196608,
      input_per_1m: 0.21,
      output_per_1m: 0.84
    },
    "minimax/minimax-m3": {
      name: "MiniMax: MiniMax M3",
      context_length: 1048576,
      input_per_1m: 0.3,
      output_per_1m: 1.2
    },
    "minimax/minimax-m3.1-flash": {
      name: "MiniMax: MiniMax M3.1 Flash",
      context_length: 1048576,
      input_per_1m: 0.15,
      output_per_1m: 0.6
    },
    "minimax/minimax-m3:batch": {
      name: "MiniMax: MiniMax M3 (batch)",
      context_length: 524288,
      input_per_1m: 0.224,
      output_per_1m: 0.88
    },
    "mistralai/codestral-2508": {
      name: "Mistral: Codestral 2508",
      context_length: 256e3,
      input_per_1m: 0.3,
      output_per_1m: 0.9
    },
    "mistralai/devstral-2512": {
      name: "Mistral: Devstral 2 2512",
      context_length: 262144,
      input_per_1m: 0.4,
      output_per_1m: 2
    },
    "mistralai/ministral-14b-2512": {
      name: "Mistral: Ministral 3 14B 2512",
      context_length: 262144,
      input_per_1m: 0.2,
      output_per_1m: 0.2
    },
    "mistralai/ministral-3b-2512": {
      name: "Mistral: Ministral 3 3B 2512",
      context_length: 131072,
      input_per_1m: 0.1,
      output_per_1m: 0.1
    },
    "mistralai/ministral-8b-2512": {
      name: "Mistral: Ministral 3 8B 2512",
      context_length: 262144,
      input_per_1m: 0.15,
      output_per_1m: 0.15
    },
    "mistralai/mistral-large": {
      name: "Mistral Large",
      context_length: 128e3,
      input_per_1m: 2,
      output_per_1m: 6
    },
    "mistralai/mistral-large-2407": {
      name: "Mistral Large 2407",
      context_length: 131072,
      input_per_1m: 2,
      output_per_1m: 6
    },
    "mistralai/mistral-large-2512": {
      name: "Mistral: Mistral Large 3 2512",
      context_length: 262144,
      input_per_1m: 0.5,
      output_per_1m: 1.5
    },
    "mistralai/mistral-large-4-0": {
      name: "Mistral: Mistral Large 4",
      context_length: 1048576,
      input_per_1m: 0.7,
      output_per_1m: 2.1
    },
    "mistralai/mistral-medium-3": {
      name: "Mistral: Mistral Medium 3",
      context_length: 131072,
      input_per_1m: 0.4,
      output_per_1m: 2
    },
    "mistralai/mistral-medium-3-5": {
      name: "Mistral: Mistral Medium 3.5",
      context_length: 262144,
      input_per_1m: 1.5,
      output_per_1m: 7.5
    },
    "mistralai/mistral-medium-3-5:batch": {
      name: "Mistral: Mistral Medium 3.5 (batch)",
      context_length: 262144,
      input_per_1m: 0.75,
      output_per_1m: 3.75
    },
    "mistralai/mistral-medium-3.1": {
      name: "Mistral: Mistral Medium 3.1",
      context_length: 131072,
      input_per_1m: 0.4,
      output_per_1m: 2
    },
    "mistralai/mistral-nemo": {
      name: "Mistral: Mistral Nemo",
      context_length: 131072,
      input_per_1m: 0.029,
      output_per_1m: 0.03
    },
    "mistralai/mistral-saba": {
      name: "Mistral: Saba",
      context_length: 32768,
      input_per_1m: 0.2,
      output_per_1m: 0.6
    },
    "mistralai/mistral-small-24b-instruct-2501": {
      name: "Mistral: Mistral Small 3",
      context_length: 32768,
      input_per_1m: 0.05,
      output_per_1m: 0.08
    },
    "mistralai/mistral-small-2603": {
      name: "Mistral: Mistral Small 4",
      context_length: 262144,
      input_per_1m: 0.15,
      output_per_1m: 0.6
    },
    "mistralai/mistral-small-3.1-24b-instruct": {
      name: "Mistral: Mistral Small 3.1 24B",
      context_length: 128e3,
      input_per_1m: 0.351,
      output_per_1m: 0.555
    },
    "mistralai/mistral-small-3.2-24b-instruct": {
      name: "Mistral: Mistral Small 3.2 24B",
      context_length: 256e3,
      input_per_1m: 0.1,
      output_per_1m: 0.3
    },
    "mistralai/mixtral-8x22b-instruct": {
      name: "Mistral: Mixtral 8x22B Instruct",
      context_length: 65536,
      input_per_1m: 2,
      output_per_1m: 6
    },
    "mistralai/voxtral-small-24b-2507": {
      name: "Mistral: Voxtral Small 24B 2507",
      context_length: 32768,
      input_per_1m: 0.1,
      output_per_1m: 0.3
    },
    "moondream/moondream3-preview": {
      name: "Moondream: Moondream 3 Preview",
      context_length: 32e3,
      input_per_1m: 0.3,
      output_per_1m: 2.5
    },
    "moondream/moondream3.1-9b-a2b": {
      name: "Moondream: Moondream 3.1",
      context_length: 32e3,
      input_per_1m: 0.3,
      output_per_1m: 2.5
    },
    "moonshotai/kimi-k2": {
      name: "MoonshotAI: Kimi K2 0711",
      context_length: 131072,
      input_per_1m: 0.57,
      output_per_1m: 2.3
    },
    "moonshotai/kimi-k2-0905": {
      name: "MoonshotAI: Kimi K2 0905",
      context_length: 262144,
      input_per_1m: 0.6,
      output_per_1m: 2.5
    },
    "moonshotai/kimi-k2-thinking": {
      name: "MoonshotAI: Kimi K2 Thinking",
      context_length: 262144,
      input_per_1m: 0.6,
      output_per_1m: 2.5
    },
    "moonshotai/kimi-k2.5": {
      name: "MoonshotAI: Kimi K2.5",
      context_length: 262144,
      input_per_1m: 0.532,
      output_per_1m: 3.325
    },
    "moonshotai/kimi-k2.6": {
      name: "MoonshotAI: Kimi K2.6",
      context_length: 262144,
      input_per_1m: 0.65,
      output_per_1m: 3.41
    },
    "moonshotai/kimi-k2.7-code": {
      name: "MoonshotAI: Kimi K2.7 Code",
      context_length: 262144,
      input_per_1m: 0.6,
      output_per_1m: 3.5
    },
    "moonshotai/kimi-k3": {
      name: "MoonshotAI: Kimi K3",
      context_length: 1048576,
      input_per_1m: 0.192,
      output_per_1m: 16
    },
    "moonshotai/kimi-k3.1-pro": {
      name: "MoonshotAI: Kimi K3.1 Pro",
      context_length: 1048576,
      input_per_1m: 2,
      output_per_1m: 10
    },
    "moonshotai/kimi-k3:batch": {
      name: "MoonshotAI: Kimi K3 (batch)",
      context_length: 1048576,
      input_per_1m: 2.28,
      output_per_1m: 11.4
    },
    "morph/morph-v3-fast": {
      name: "Morph: Morph V3 Fast",
      context_length: 262144,
      input_per_1m: 0.8,
      output_per_1m: 1.2
    },
    "morph/morph-v3-fast:batch": {
      name: "Morph: Morph V3 Fast (batch)",
      context_length: 81920,
      input_per_1m: 0.4,
      output_per_1m: 0.6
    },
    "morph/morph-v3-large": {
      name: "Morph: Morph V3 Large",
      context_length: 262144,
      input_per_1m: 0.9,
      output_per_1m: 1.9
    },
    "morph/morph-v3-large:batch": {
      name: "Morph: Morph V3 Large (batch)",
      context_length: 262144,
      input_per_1m: 0.45,
      output_per_1m: 0.95
    },
    "motif-technologies/motif-3": {
      name: "Motif Technologies: Motif 3",
      context_length: 262144,
      input_per_1m: 0.3,
      output_per_1m: 1.2
    },
    "nex-agi/nex-n2.5-mini": {
      name: "Nex AGI: Nex-N2.5-Mini",
      context_length: 262144,
      input_per_1m: 0.025,
      output_per_1m: 0.1
    },
    "nex-agi/nex-n2.5-pro": {
      name: "Nex AGI: Nex-N2.5-Pro",
      context_length: 262144,
      input_per_1m: 0.075,
      output_per_1m: 0.25
    },
    "nex-agi/nex-n2.6": {
      name: "Nex AGI: Nex-N2.6",
      context_length: 262144,
      input_per_1m: 0.12,
      output_per_1m: 0.4
    },
    "nousresearch/hermes-4-405b": {
      name: "Nous: Hermes 4 405B",
      context_length: 131072,
      input_per_1m: 1,
      output_per_1m: 3
    },
    "nvidia/nemotron-3-nano-30b-a3b": {
      name: "NVIDIA: Nemotron 3 Nano 30B A3B",
      context_length: 262144,
      input_per_1m: 0.06,
      output_per_1m: 0.24
    },
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": {
      name: "NVIDIA: Nemotron 3 Nano Omni (free)",
      context_length: 256e3,
      input_per_1m: 0,
      output_per_1m: 0
    },
    "nvidia/nemotron-3-super-120b-a12b": {
      name: "NVIDIA: Nemotron 3 Super",
      context_length: 262144,
      input_per_1m: 0.075,
      output_per_1m: 0.4
    },
    "nvidia/nemotron-3-ultra-550b-a55b": {
      name: "NVIDIA: Nemotron 3 Ultra",
      context_length: 262144,
      input_per_1m: 0.6,
      output_per_1m: 2.4
    },
    "nvidia/nemotron-3-ultra-550b-a55b:free": {
      name: "NVIDIA: Nemotron 3 Ultra (free)",
      context_length: 1e6,
      input_per_1m: 0,
      output_per_1m: 0
    },
    "nvidia/nemotron-3.5-content-safety": {
      name: "NVIDIA: Nemotron 3.5 Content Safety",
      context_length: 131072,
      input_per_1m: 0.2,
      output_per_1m: 0.2
    },
    "nvidia/nemotron-3.5-lightning": {
      name: "NVIDIA: Nemotron 3.5 Lightning",
      context_length: 262144,
      input_per_1m: 0.07,
      output_per_1m: 0.2
    },
    "nvidia/nemotron-3.5-lightning:free": {
      name: "NVIDIA: Nemotron 3.5 Lightning (free)",
      context_length: 1e6,
      input_per_1m: 0,
      output_per_1m: 0
    },
    "nvidia/nemotron-3.5-super-vl": {
      name: "NVIDIA: Nemotron 3.5 Super VL",
      context_length: 1048576,
      input_per_1m: 0.15,
      output_per_1m: 0.47
    },
    "nvidia/nemotron-3.5-super-vl:free": {
      name: "NVIDIA: Nemotron 3.5 Super VL (free)",
      context_length: 1e6,
      input_per_1m: 0,
      output_per_1m: 0
    },
    "openai/gpt-3.5-turbo-0613": {
      name: "OpenAI: GPT-3.5 Turbo (older v0613)",
      context_length: 4095,
      input_per_1m: 1,
      output_per_1m: 2
    },
    "openai/gpt-3.5-turbo-16k": {
      name: "OpenAI: GPT-3.5 Turbo 16k",
      context_length: 16385,
      input_per_1m: 3,
      output_per_1m: 4
    },
    "openai/gpt-4": {
      name: "OpenAI: GPT-4",
      context_length: 8191,
      input_per_1m: 30,
      output_per_1m: 60
    },
    "openai/gpt-4-turbo:batch": {
      name: "OpenAI: GPT-4 Turbo (batch)",
      context_length: 128e3,
      input_per_1m: 5,
      output_per_1m: 15
    },
    "openai/gpt-4.1": {
      name: "OpenAI: GPT-4.1",
      context_length: 1047576,
      input_per_1m: 2,
      output_per_1m: 8
    },
    "openai/gpt-4.1-mini": {
      name: "OpenAI: GPT-4.1 Mini",
      context_length: 1047576,
      input_per_1m: 0.4,
      output_per_1m: 1.6
    },
    "openai/gpt-4.1-mini:batch": {
      name: "OpenAI: GPT-4.1 Mini (batch)",
      context_length: 1047576,
      input_per_1m: 0.2,
      output_per_1m: 0.8
    },
    "openai/gpt-4.1-nano": {
      name: "OpenAI: GPT-4.1 Nano",
      context_length: 1047576,
      input_per_1m: 0.1,
      output_per_1m: 0.4
    },
    "openai/gpt-4.1-nano:batch": {
      name: "OpenAI: GPT-4.1 Nano (batch)",
      context_length: 1047576,
      input_per_1m: 0.05,
      output_per_1m: 0.2
    },
    "openai/gpt-4.1:batch": {
      name: "OpenAI: GPT-4.1 (batch)",
      context_length: 1047576,
      input_per_1m: 1,
      output_per_1m: 4
    },
    "openai/gpt-4o": {
      name: "OpenAI: GPT-4o",
      context_length: 128e3,
      input_per_1m: 2.5,
      output_per_1m: 10
    },
    "openai/gpt-4o-2024-05-13": {
      name: "OpenAI: GPT-4o (2024-05-13)",
      context_length: 128e3,
      input_per_1m: 5,
      output_per_1m: 15
    },
    "openai/gpt-4o-2024-08-06": {
      name: "OpenAI: GPT-4o (2024-08-06)",
      context_length: 128e3,
      input_per_1m: 2.5,
      output_per_1m: 10
    },
    "openai/gpt-4o-2024-11-20": {
      name: "OpenAI: GPT-4o (2024-11-20)",
      context_length: 128e3,
      input_per_1m: 2.5,
      output_per_1m: 10
    },
    "openai/gpt-4o-mini": {
      name: "OpenAI: GPT-4o-mini",
      context_length: 128e3,
      input_per_1m: 0.15,
      output_per_1m: 0.6
    },
    "openai/gpt-4o-mini-2024-07-18": {
      name: "OpenAI: GPT-4o-mini (2024-07-18)",
      context_length: 128e3,
      input_per_1m: 0.15,
      output_per_1m: 0.6
    },
    "openai/gpt-4o-mini:batch": {
      name: "OpenAI: GPT-4o-mini (batch)",
      context_length: 128e3,
      input_per_1m: 0.075,
      output_per_1m: 0.3
    },
    "openai/gpt-4o:batch": {
      name: "OpenAI: GPT-4o (batch)",
      context_length: 128e3,
      input_per_1m: 1.25,
      output_per_1m: 5
    },
    "openai/gpt-5": {
      name: "OpenAI: GPT-5",
      context_length: 4e5,
      input_per_1m: 1.25,
      output_per_1m: 10
    },
    "openai/gpt-5-image": {
      name: "OpenAI: GPT-5 Image",
      context_length: 4e5,
      input_per_1m: 10,
      output_per_1m: 10
    },
    "openai/gpt-5-image-mini": {
      name: "OpenAI: GPT-5 Image Mini",
      context_length: 4e5,
      input_per_1m: 2.5,
      output_per_1m: 2
    },
    "openai/gpt-5-mini": {
      name: "OpenAI: GPT-5 Mini",
      context_length: 4e5,
      input_per_1m: 0.25,
      output_per_1m: 2
    },
    "openai/gpt-5-mini:batch": {
      name: "OpenAI: GPT-5 Mini (batch)",
      context_length: 4e5,
      input_per_1m: 0.125,
      output_per_1m: 1
    },
    "openai/gpt-5-nano": {
      name: "OpenAI: GPT-5 Nano",
      context_length: 4e5,
      input_per_1m: 0.05,
      output_per_1m: 0.4
    },
    "openai/gpt-5-nano:batch": {
      name: "OpenAI: GPT-5 Nano (batch)",
      context_length: 4e5,
      input_per_1m: 0.025,
      output_per_1m: 0.2
    },
    "openai/gpt-5-pro": {
      name: "OpenAI: GPT-5 Pro",
      context_length: 4e5,
      input_per_1m: 15,
      output_per_1m: 120
    },
    "openai/gpt-5-pro:batch": {
      name: "OpenAI: GPT-5 Pro (batch)",
      context_length: 4e5,
      input_per_1m: 7.5,
      output_per_1m: 60
    },
    "openai/gpt-5.1": {
      name: "OpenAI: GPT-5.1",
      context_length: 4e5,
      input_per_1m: 1.25,
      output_per_1m: 10
    },
    "openai/gpt-5.1-codex": {
      name: "OpenAI: GPT-5.1-Codex",
      context_length: 4e5,
      input_per_1m: 1.25,
      output_per_1m: 10
    },
    "openai/gpt-5.1-codex-max": {
      name: "OpenAI: GPT-5.1-Codex-Max",
      context_length: 4e5,
      input_per_1m: 1.25,
      output_per_1m: 10
    },
    "openai/gpt-5.1-codex-mini": {
      name: "OpenAI: GPT-5.1-Codex-Mini",
      context_length: 4e5,
      input_per_1m: 0.25,
      output_per_1m: 2
    },
    "openai/gpt-5.1:batch": {
      name: "OpenAI: GPT-5.1 (batch)",
      context_length: 4e5,
      input_per_1m: 0.625,
      output_per_1m: 5
    },
    "openai/gpt-5.2": {
      name: "OpenAI: GPT-5.2",
      context_length: 4e5,
      input_per_1m: 1.75,
      output_per_1m: 14
    },
    "openai/gpt-5.2-chat": {
      name: "OpenAI: GPT-5.2 Chat",
      context_length: 128e3,
      input_per_1m: 1.75,
      output_per_1m: 14
    },
    "openai/gpt-5.2-codex": {
      name: "OpenAI: GPT-5.2-Codex",
      context_length: 4e5,
      input_per_1m: 1.75,
      output_per_1m: 14
    },
    "openai/gpt-5.2-pro": {
      name: "OpenAI: GPT-5.2 Pro",
      context_length: 4e5,
      input_per_1m: 21,
      output_per_1m: 168
    },
    "openai/gpt-5.2-pro:batch": {
      name: "OpenAI: GPT-5.2 Pro (batch)",
      context_length: 4e5,
      input_per_1m: 10.5,
      output_per_1m: 84
    },
    "openai/gpt-5.2:batch": {
      name: "OpenAI: GPT-5.2 (batch)",
      context_length: 4e5,
      input_per_1m: 0.875,
      output_per_1m: 7
    },
    "openai/gpt-5.3-codex": {
      name: "OpenAI: GPT-5.3-Codex",
      context_length: 4e5,
      input_per_1m: 1.75,
      output_per_1m: 14
    },
    "openai/gpt-5.4": {
      name: "OpenAI: GPT-5.4",
      context_length: 105e4,
      input_per_1m: 2.5,
      output_per_1m: 15
    },
    "openai/gpt-5.4-image-2": {
      name: "OpenAI: GPT-5.4 Image 2",
      context_length: 272e3,
      input_per_1m: 8,
      output_per_1m: 15
    },
    "openai/gpt-5.4-mini": {
      name: "OpenAI: GPT-5.4 Mini",
      context_length: 4e5,
      input_per_1m: 0.75,
      output_per_1m: 4.5
    },
    "openai/gpt-5.4-mini:batch": {
      name: "OpenAI: GPT-5.4 Mini (batch)",
      context_length: 4e5,
      input_per_1m: 0.375,
      output_per_1m: 2.25
    },
    "openai/gpt-5.4-nano": {
      name: "OpenAI: GPT-5.4 Nano",
      context_length: 4e5,
      input_per_1m: 0.2,
      output_per_1m: 1.25
    },
    "openai/gpt-5.4-nano:batch": {
      name: "OpenAI: GPT-5.4 Nano (batch)",
      context_length: 4e5,
      input_per_1m: 0.1,
      output_per_1m: 0.625
    },
    "openai/gpt-5.4-pro": {
      name: "OpenAI: GPT-5.4 Pro",
      context_length: 105e4,
      input_per_1m: 30,
      output_per_1m: 180
    },
    "openai/gpt-5.4-pro:batch": {
      name: "OpenAI: GPT-5.4 Pro (batch)",
      context_length: 105e4,
      input_per_1m: 15,
      output_per_1m: 90
    },
    "openai/gpt-5.4:batch": {
      name: "OpenAI: GPT-5.4 (batch)",
      context_length: 105e4,
      input_per_1m: 1.25,
      output_per_1m: 7.5
    },
    "openai/gpt-5.5": {
      name: "OpenAI: GPT-5.5",
      context_length: 105e4,
      input_per_1m: 5,
      output_per_1m: 30
    },
    "openai/gpt-5.5-pro": {
      name: "OpenAI: GPT-5.5 Pro",
      context_length: 105e4,
      input_per_1m: 30,
      output_per_1m: 180
    },
    "openai/gpt-5.5-pro:batch": {
      name: "OpenAI: GPT-5.5 Pro (batch)",
      context_length: 105e4,
      input_per_1m: 15,
      output_per_1m: 90
    },
    "openai/gpt-5.5:batch": {
      name: "OpenAI: GPT-5.5 (batch)",
      context_length: 105e4,
      input_per_1m: 2.5,
      output_per_1m: 15
    },
    "openai/gpt-5.6-luna": {
      name: "OpenAI: GPT-5.6 Luna",
      context_length: 105e4,
      input_per_1m: 0.2,
      output_per_1m: 1.2
    },
    "openai/gpt-5.6-luna-pro": {
      name: "OpenAI: GPT-5.6 Luna Pro",
      context_length: 105e4,
      input_per_1m: 0.2,
      output_per_1m: 1.2
    },
    "openai/gpt-5.6-luna-pro:batch": {
      name: "OpenAI: GPT-5.6 Luna Pro (batch)",
      context_length: 105e4,
      input_per_1m: 0.1,
      output_per_1m: 0.6
    },
    "openai/gpt-5.6-luna:batch": {
      name: "OpenAI: GPT-5.6 Luna (batch)",
      context_length: 105e4,
      input_per_1m: 0.1,
      output_per_1m: 0.6
    },
    "openai/gpt-5.6-sol": {
      name: "OpenAI: GPT-5.6 Sol",
      context_length: 105e4,
      input_per_1m: 4,
      output_per_1m: 20
    },
    "openai/gpt-5.6-sol-pro": {
      name: "OpenAI: GPT-5.6 Sol Pro",
      context_length: 105e4,
      input_per_1m: 4,
      output_per_1m: 20
    },
    "openai/gpt-5.6-sol-pro:batch": {
      name: "OpenAI: GPT-5.6 Sol Pro (batch)",
      context_length: 105e4,
      input_per_1m: 2,
      output_per_1m: 10
    },
    "openai/gpt-5.6-sol:batch": {
      name: "OpenAI: GPT-5.6 Sol (batch)",
      context_length: 105e4,
      input_per_1m: 2,
      output_per_1m: 10
    },
    "openai/gpt-5.6-terra": {
      name: "OpenAI: GPT-5.6 Terra",
      context_length: 105e4,
      input_per_1m: 2,
      output_per_1m: 12
    },
    "openai/gpt-5.6-terra-pro": {
      name: "OpenAI: GPT-5.6 Terra Pro",
      context_length: 105e4,
      input_per_1m: 2,
      output_per_1m: 12
    },
    "openai/gpt-5.6-terra-pro:batch": {
      name: "OpenAI: GPT-5.6 Terra Pro (batch)",
      context_length: 105e4,
      input_per_1m: 1,
      output_per_1m: 6
    },
    "openai/gpt-5.6-terra:batch": {
      name: "OpenAI: GPT-5.6 Terra (batch)",
      context_length: 105e4,
      input_per_1m: 1,
      output_per_1m: 6
    },
    "openai/gpt-5:batch": {
      name: "OpenAI: GPT-5 (batch)",
      context_length: 4e5,
      input_per_1m: 0.625,
      output_per_1m: 5
    },
    "openai/gpt-6-astra": {
      name: "OpenAI: GPT-6 Astra",
      context_length: 105e4,
      input_per_1m: 10,
      output_per_1m: 50
    },
    "openai/gpt-6-astra-pro": {
      name: "OpenAI: GPT-6 Astra Pro",
      context_length: 105e4,
      input_per_1m: 10,
      output_per_1m: 50
    },
    "openai/gpt-6-astra-pro:batch": {
      name: "OpenAI: GPT-6 Astra Pro (batch)",
      context_length: 105e4,
      input_per_1m: 5,
      output_per_1m: 25
    },
    "openai/gpt-6-astra:batch": {
      name: "OpenAI: GPT-6 Astra (batch)",
      context_length: 105e4,
      input_per_1m: 5,
      output_per_1m: 25
    },
    "openai/gpt-6-luna": {
      name: "OpenAI: GPT-6 Luna",
      context_length: 105e4,
      input_per_1m: 0.1,
      output_per_1m: 0.5
    },
    "openai/gpt-6-luna-pro": {
      name: "OpenAI: GPT-6 Luna Pro",
      context_length: 105e4,
      input_per_1m: 0.1,
      output_per_1m: 0.5
    },
    "openai/gpt-6-luna-pro:batch": {
      name: "OpenAI: GPT-6 Luna Pro (batch)",
      context_length: 105e4,
      input_per_1m: 0.05,
      output_per_1m: 0.25
    },
    "openai/gpt-6-luna:batch": {
      name: "OpenAI: GPT-6 Luna (batch)",
      context_length: 105e4,
      input_per_1m: 0.05,
      output_per_1m: 0.25
    },
    "openai/gpt-6-sol": {
      name: "OpenAI: GPT-6 Sol",
      context_length: 105e4,
      input_per_1m: 2,
      output_per_1m: 10
    },
    "openai/gpt-6-sol-pro": {
      name: "OpenAI: GPT-6 Sol Pro",
      context_length: 105e4,
      input_per_1m: 2,
      output_per_1m: 10
    },
    "openai/gpt-6-sol-pro:batch": {
      name: "OpenAI: GPT-6 Sol Pro (batch)",
      context_length: 105e4,
      input_per_1m: 1,
      output_per_1m: 5
    },
    "openai/gpt-6-sol:batch": {
      name: "OpenAI: GPT-6 Sol (batch)",
      context_length: 105e4,
      input_per_1m: 1,
      output_per_1m: 5
    },
    "openai/gpt-6.1-sol": {
      name: "OpenAI: GPT-6.1 Sol",
      context_length: 105e4,
      input_per_1m: 2,
      output_per_1m: 10
    },
    "openai/gpt-6.1-sol-pro": {
      name: "OpenAI: GPT-6.1 Sol Pro",
      context_length: 105e4,
      input_per_1m: 2,
      output_per_1m: 10
    },
    "openai/gpt-6.1-sol-pro:batch": {
      name: "OpenAI: GPT-6.1 Sol Pro (batch)",
      context_length: 105e4,
      input_per_1m: 1,
      output_per_1m: 5
    },
    "openai/gpt-6.1-sol:batch": {
      name: "OpenAI: GPT-6.1 Sol (batch)",
      context_length: 105e4,
      input_per_1m: 1,
      output_per_1m: 5
    },
    "openai/gpt-6.1-terra": {
      name: "OpenAI: GPT-6.1 Terra",
      context_length: 105e4,
      input_per_1m: 1,
      output_per_1m: 5
    },
    "openai/gpt-6.1-terra-pro": {
      name: "OpenAI: GPT-6.1 Terra Pro",
      context_length: 105e4,
      input_per_1m: 1,
      output_per_1m: 5
    },
    "openai/gpt-6.1-terra-pro:batch": {
      name: "OpenAI: GPT-6.1 Terra Pro (batch)",
      context_length: 105e4,
      input_per_1m: 0.5,
      output_per_1m: 2.5
    },
    "openai/gpt-6.1-terra:batch": {
      name: "OpenAI: GPT-6.1 Terra (batch)",
      context_length: 105e4,
      input_per_1m: 0.5,
      output_per_1m: 2.5
    },
    "openai/gpt-audio": {
      name: "OpenAI: GPT Audio",
      context_length: 128e3,
      input_per_1m: 2.5,
      output_per_1m: 10
    },
    "openai/gpt-audio-mini": {
      name: "OpenAI: GPT Audio Mini",
      context_length: 128e3,
      input_per_1m: 0.6,
      output_per_1m: 2.4
    },
    "openai/gpt-chat-latest": {
      name: "OpenAI: GPT Chat Latest",
      context_length: 4e5,
      input_per_1m: 5,
      output_per_1m: 30
    },
    "openai/gpt-oss-120b": {
      name: "OpenAI: gpt-oss-120b",
      context_length: 131072,
      input_per_1m: 0.15,
      output_per_1m: 0.6
    },
    "openai/gpt-oss-120b:batch": {
      name: "OpenAI: gpt-oss-120b (batch)",
      context_length: 131072,
      input_per_1m: 0.0296,
      output_per_1m: 0.136
    },
    "openai/gpt-oss-20b": {
      name: "OpenAI: gpt-oss-20b",
      context_length: 131072,
      input_per_1m: 0.03,
      output_per_1m: 0.13
    },
    "openai/gpt-oss-20b:batch": {
      name: "OpenAI: gpt-oss-20b (batch)",
      context_length: 131072,
      input_per_1m: 0.024,
      output_per_1m: 0.112
    },
    "openai/gpt-oss-safeguard-20b": {
      name: "OpenAI: gpt-oss-safeguard-20b",
      context_length: 131072,
      input_per_1m: 0.075,
      output_per_1m: 0.3
    },
    "openai/o3": {
      name: "OpenAI: o3",
      context_length: 2e5,
      input_per_1m: 2,
      output_per_1m: 8
    },
    "openai/o3-mini:batch": {
      name: "OpenAI: o3 Mini (batch)",
      context_length: 2e5,
      input_per_1m: 0.55,
      output_per_1m: 2.2
    },
    "openai/o3-pro": {
      name: "OpenAI: o3 Pro",
      context_length: 2e5,
      input_per_1m: 20,
      output_per_1m: 80
    },
    "openai/o3:batch": {
      name: "OpenAI: o3 (batch)",
      context_length: 2e5,
      input_per_1m: 1,
      output_per_1m: 4
    },
    "openai/o4-mini:batch": {
      name: "OpenAI: o4 Mini (batch)",
      context_length: 2e5,
      input_per_1m: 0.55,
      output_per_1m: 2.2
    },
    "openrouter/free": {
      name: "Free Models Router",
      context_length: 2e5,
      input_per_1m: 0,
      output_per_1m: 0
    },
    "particle-ai/particle-1": {
      name: "Particle AI: Particle-1",
      context_length: 1048576,
      input_per_1m: 0.05,
      output_per_1m: 0.5
    },
    "perceptron/perceptron-mk1": {
      name: "Perceptron: Perceptron Mk1",
      context_length: 32768,
      input_per_1m: 0.15,
      output_per_1m: 1.5
    },
    "perceptron/perceptron-mk1.5": {
      name: "Perceptron: Perceptron Mk1.5",
      context_length: 36864,
      input_per_1m: 0.15,
      output_per_1m: 1.5
    },
    "perplexity/sonar": {
      name: "Perplexity: Sonar",
      context_length: 127072,
      input_per_1m: 1,
      output_per_1m: 1
    },
    "perplexity/sonar-deep-research": {
      name: "Perplexity: Sonar Deep Research",
      context_length: 128e3,
      input_per_1m: 2,
      output_per_1m: 8
    },
    "perplexity/sonar-pro": {
      name: "Perplexity: Sonar Pro",
      context_length: 2e5,
      input_per_1m: 3,
      output_per_1m: 15
    },
    "perplexity/sonar-pro-search": {
      name: "Perplexity: Sonar Pro Search",
      context_length: 2e5,
      input_per_1m: 3,
      output_per_1m: 15
    },
    "perplexity/sonar-reasoning-pro": {
      name: "Perplexity: Sonar Reasoning Pro",
      context_length: 128e3,
      input_per_1m: 2,
      output_per_1m: 8
    },
    "prism-ml/ternary-bonsai-2-27b": {
      name: "PrismML: Ternary Bonsai 2 27B",
      context_length: 262144,
      input_per_1m: 0.075,
      output_per_1m: 0.5
    },
    "prism-ml/ternary-bonsai-2-9b": {
      name: "PrismML: Ternary Bonsai 2 9B",
      context_length: 262144,
      input_per_1m: 0.08,
      output_per_1m: 0.13
    },
    "qwen/qwen-2.5-72b-instruct": {
      name: "Qwen2.5 72B Instruct",
      context_length: 32768,
      input_per_1m: 0.36,
      output_per_1m: 0.4
    },
    "qwen/qwen-2.5-coder-32b-instruct": {
      name: "Qwen2.5 Coder 32B Instruct",
      context_length: 32768,
      input_per_1m: 0.66,
      output_per_1m: 1
    },
    "qwen/qwen-plus": {
      name: "Qwen: Qwen-Plus",
      context_length: 1e6,
      input_per_1m: 0.26,
      output_per_1m: 0.78
    },
    "qwen/qwen2.5-vl-72b-instruct": {
      name: "Qwen: Qwen2.5 VL 72B Instruct",
      context_length: 128e3,
      input_per_1m: 0.8,
      output_per_1m: 1
    },
    "qwen/qwen3-14b": {
      name: "Qwen: Qwen3 14B",
      context_length: 40960,
      input_per_1m: 0.1,
      output_per_1m: 0.22
    },
    "qwen/qwen3-235b-a22b-2507": {
      name: "Qwen: Qwen3 235B A22B Instruct 2507",
      context_length: 262144,
      input_per_1m: 0.14,
      output_per_1m: 0.8
    },
    "qwen/qwen3-235b-a22b-thinking-2507": {
      name: "Qwen: Qwen3 235B A22B Thinking 2507",
      context_length: 128e3,
      input_per_1m: 0.45,
      output_per_1m: 3.5
    },
    "qwen/qwen3-30b-a3b": {
      name: "Qwen: Qwen3 30B A3B",
      context_length: 40960,
      input_per_1m: 0.12,
      output_per_1m: 0.5
    },
    "qwen/qwen3-30b-a3b-instruct-2507": {
      name: "Qwen: Qwen3 30B A3B Instruct 2507",
      context_length: 262144,
      input_per_1m: 0.1,
      output_per_1m: 0.3
    },
    "qwen/qwen3-32b": {
      name: "Qwen: Qwen3 32B",
      context_length: 131072,
      input_per_1m: 0.08,
      output_per_1m: 0.28
    },
    "qwen/qwen3-coder": {
      name: "Qwen: Qwen3 Coder 480B A35B",
      context_length: 262144,
      input_per_1m: 0.3,
      output_per_1m: 1
    },
    "qwen/qwen3-coder-30b-a3b-instruct": {
      name: "Qwen: Qwen3 Coder 30B A3B Instruct",
      context_length: 262144,
      input_per_1m: 0.15,
      output_per_1m: 0.6
    },
    "qwen/qwen3-coder-flash": {
      name: "Qwen: Qwen3 Coder Flash",
      context_length: 1e6,
      input_per_1m: 0.195,
      output_per_1m: 0.975
    },
    "qwen/qwen3-coder-next": {
      name: "Qwen: Qwen3 Coder Next",
      context_length: 262144,
      input_per_1m: 0.12,
      output_per_1m: 0.8
    },
    "qwen/qwen3-next-80b-a3b-instruct": {
      name: "Qwen: Qwen3 Next 80B A3B Instruct",
      context_length: 262144,
      input_per_1m: 0.09,
      output_per_1m: 1.1
    },
    "qwen/qwen3-vl-235b-a22b-instruct": {
      name: "Qwen: Qwen3 VL 235B A22B Instruct",
      context_length: 262144,
      input_per_1m: 0.21,
      output_per_1m: 1.9
    },
    "qwen/qwen3-vl-30b-a3b-instruct": {
      name: "Qwen: Qwen3 VL 30B A3B Instruct",
      context_length: 262144,
      input_per_1m: 0.15,
      output_per_1m: 0.6
    },
    "qwen/qwen3-vl-30b-a3b-thinking": {
      name: "Qwen: Qwen3 VL 30B A3B Thinking",
      context_length: 262144,
      input_per_1m: 0.29,
      output_per_1m: 1
    },
    "qwen/qwen3-vl-8b-instruct": {
      name: "Qwen: Qwen3 VL 8B Instruct",
      context_length: 262144,
      input_per_1m: 0.25,
      output_per_1m: 0.75
    },
    "qwen/qwen3.5-122b-a10b": {
      name: "Qwen: Qwen3.5-122B-A10B",
      context_length: 262144,
      input_per_1m: 0.26,
      output_per_1m: 2.08
    },
    "qwen/qwen3.5-27b": {
      name: "Qwen: Qwen3.5-27B",
      context_length: 262144,
      input_per_1m: 0.26,
      output_per_1m: 2.6
    },
    "qwen/qwen3.5-35b-a3b": {
      name: "Qwen: Qwen3.5-35B-A3B",
      context_length: 262144,
      input_per_1m: 0.14,
      output_per_1m: 1
    },
    "qwen/qwen3.5-397b-a17b": {
      name: "Qwen: Qwen3.5 397B A17B",
      context_length: 262144,
      input_per_1m: 0.6,
      output_per_1m: 3.6
    },
    "qwen/qwen3.5-9b": {
      name: "Qwen: Qwen3.5-9B",
      context_length: 262144,
      input_per_1m: 0.17,
      output_per_1m: 0.25
    },
    "qwen/qwen3.5-flash-02-23": {
      name: "Qwen: Qwen3.5-Flash",
      context_length: 1e6,
      input_per_1m: 0.065,
      output_per_1m: 0.26
    },
    "qwen/qwen3.5-plus-02-15": {
      name: "Qwen: Qwen3.5 Plus 2026-02-15",
      context_length: 1e6,
      input_per_1m: 0.26,
      output_per_1m: 1.56
    },
    "qwen/qwen3.5-plus-20260420": {
      name: "Qwen: Qwen3.5 Plus 2026-04-20",
      context_length: 1e6,
      input_per_1m: 0.3,
      output_per_1m: 1.8
    },
    "qwen/qwen3.6-27b": {
      name: "Qwen: Qwen3.6 27B",
      context_length: 262144,
      input_per_1m: 0.32,
      output_per_1m: 3.2
    },
    "qwen/qwen3.6-35b-a3b": {
      name: "Qwen: Qwen3.6 35B A3B",
      context_length: 262144,
      input_per_1m: 0.1,
      output_per_1m: 0.9
    },
    "qwen/qwen3.6-flash": {
      name: "Qwen: Qwen3.6 Flash",
      context_length: 1e6,
      input_per_1m: 0.1875,
      output_per_1m: 1.125
    },
    "qwen/qwen3.6-plus": {
      name: "Qwen: Qwen3.6 Plus",
      context_length: 1e6,
      input_per_1m: 0.325,
      output_per_1m: 1.95
    },
    "qwen/qwen3.7-flash": {
      name: "Qwen: Qwen3.7 Flash",
      context_length: 1e6,
      input_per_1m: 0.03,
      output_per_1m: 0.13
    },
    "qwen/qwen3.7-max": {
      name: "Qwen: Qwen3.7 Max",
      context_length: 1e6,
      input_per_1m: 1.475,
      output_per_1m: 4.425
    },
    "qwen/qwen3.7-plus": {
      name: "Qwen: Qwen3.7 Plus",
      context_length: 1e6,
      input_per_1m: 0.32,
      output_per_1m: 1.28
    },
    "qwen/qwen3.7-plus:batch": {
      name: "Qwen: Qwen3.7 Plus (batch)",
      context_length: 262144,
      input_per_1m: 0.23,
      output_per_1m: 0.92
    },
    "qwen/qwen3.8-2.4t-a95b": {
      name: "Qwen: Qwen3.8 2.4T A95B",
      context_length: 1048576,
      input_per_1m: 2,
      output_per_1m: 6
    },
    "qwen/qwen3.8-27b": {
      name: "Qwen: Qwen3.8 27B",
      context_length: 1048575,
      input_per_1m: 0.15,
      output_per_1m: 1.875
    },
    "qwen/qwen3.8-27b:batch": {
      name: "Qwen: Qwen3.8 27B (batch)",
      context_length: 262144,
      input_per_1m: 0.16,
      output_per_1m: 2
    },
    "qwen/qwen3.8-flash": {
      name: "Qwen: Qwen3.8 Flash",
      context_length: 1e6,
      input_per_1m: 0.15,
      output_per_1m: 0.47
    },
    "qwen/qwen3.8-max-0902": {
      name: "Qwen: Qwen3.8 Max (0902)",
      context_length: 1e6,
      input_per_1m: 2,
      output_per_1m: 6
    },
    "qwen/qwen3.8-max-0902:batch": {
      name: "Qwen: Qwen3.8 Max (0902) (batch)",
      context_length: 262144,
      input_per_1m: 1.15,
      output_per_1m: 3.45
    },
    "qwen/qwen3.8-max-prime": {
      name: "Qwen: Qwen3.8 Max Prime",
      context_length: 1e6,
      input_per_1m: 4,
      output_per_1m: 12
    },
    "qwen/qwen3.8-omni-flash": {
      name: "Qwen: Qwen3.8 Omni Flash",
      context_length: 1e6,
      input_per_1m: 0.15,
      output_per_1m: 0.47
    },
    "recursive/flint-v1.0:free": {
      name: "Recursive: Flint (free)",
      context_length: 262144,
      input_per_1m: 0,
      output_per_1m: 0
    },
    "reflection/beam-1.0-501b-a23b": {
      name: "Reflection: Beam 1.0 501B A23B",
      context_length: 1048576,
      input_per_1m: 0.3,
      output_per_1m: 1
    },
    "rekaai/reka-edge": {
      name: "Reka Edge",
      context_length: 16384,
      input_per_1m: 0.1,
      output_per_1m: 0.1
    },
    "rekaai/reka-flash-3": {
      name: "Reka Flash 3",
      context_length: 65536,
      input_per_1m: 0.1,
      output_per_1m: 0.2
    },
    "relace/relace-apply-3": {
      name: "Relace: Relace Apply 3",
      context_length: 256e3,
      input_per_1m: 0.85,
      output_per_1m: 1.25
    },
    "relace/relace-search": {
      name: "Relace: Relace Search",
      context_length: 256e3,
      input_per_1m: 1,
      output_per_1m: 3
    },
    "ricursiveai/ripple-65b-preview": {
      name: "Ricursive: Ripple 65B Preview",
      context_length: 1048576,
      input_per_1m: 0.2,
      output_per_1m: 0.6
    },
    "sakana/fugu-max": {
      name: "Sakana: Fugu Max",
      context_length: 1e6,
      input_per_1m: 2,
      output_per_1m: 6
    },
    "sakana/fugu-ultra": {
      name: "Sakana: Fugu Ultra",
      context_length: 1e6,
      input_per_1m: 5,
      output_per_1m: 30
    },
    "sakana/fugu-ultra-v2": {
      name: "Sakana: Fugu Ultra v2",
      context_length: 1e6,
      input_per_1m: 5,
      output_per_1m: 30
    },
    "sakana/sakana-namazu": {
      name: "Sakana: Sakana Namazu",
      context_length: 262144,
      input_per_1m: 0.95,
      output_per_1m: 4
    },
    "sao10k/l3-lunaris-8b": {
      name: "Sao10K: Llama 3 8B Lunaris",
      context_length: 8192,
      input_per_1m: 0.04,
      output_per_1m: 0.05
    },
    "sao10k/l3.1-euryale-70b": {
      name: "Sao10K: Llama 3.1 Euryale 70B v2.2",
      context_length: 131072,
      input_per_1m: 0.85,
      output_per_1m: 0.85
    },
    "scaledown/extract": {
      name: "ScaleDown: Extract",
      context_length: 1e6,
      input_per_1m: 0.04,
      output_per_1m: 0
    },
    "scaledown/summarize": {
      name: "ScaleDown: Summarize",
      context_length: 1e6,
      input_per_1m: 0.04,
      output_per_1m: 0
    },
    "stepfun/step-3.5-flash": {
      name: "StepFun: Step 3.5 Flash",
      context_length: 262144,
      input_per_1m: 0.1,
      output_per_1m: 0.3
    },
    "stepfun/step-3.7-flash": {
      name: "StepFun: Step 3.7 Flash",
      context_length: 262144,
      input_per_1m: 0.2,
      output_per_1m: 1.15
    },
    "stepfun/step-5-preview": {
      name: "StepFun: Step 5 Preview",
      context_length: 1e6,
      input_per_1m: 1,
      output_per_1m: 2.7
    },
    "tencent/hunyuan-a13b-instruct": {
      name: "Tencent: Hunyuan A13B Instruct",
      context_length: 131072,
      input_per_1m: 0.14,
      output_per_1m: 0.57
    },
    "tencent/hy-mt2-1.8b": {
      name: "Tencent: Hy-MT2-1.8B",
      context_length: 8192,
      input_per_1m: 0.044,
      output_per_1m: 0.177
    },
    "tencent/hy-mt2-30b-a3b": {
      name: "Tencent: Hy-MT2-30B-A3B",
      context_length: 8192,
      input_per_1m: 0.074,
      output_per_1m: 0.295
    },
    "tencent/hy-mt2-7b": {
      name: "Tencent: Hy-MT2-7B",
      context_length: 8192,
      input_per_1m: 0.074,
      output_per_1m: 0.295
    },
    "tencent/hy3": {
      name: "Tencent: Hy3",
      context_length: 262144,
      input_per_1m: 0.132,
      output_per_1m: 0.528
    },
    "tencent/hy3-preview": {
      name: "Tencent: Hy3 preview",
      context_length: 262144,
      input_per_1m: 0.18,
      output_per_1m: 0.6
    },
    "tencent/hy4": {
      name: "Tencent: Hy4",
      context_length: 1048576,
      input_per_1m: 0.417,
      output_per_1m: 1.2505
    },
    "tencent/hy4-preview": {
      name: "Tencent: Hy4 preview",
      context_length: 1048576,
      input_per_1m: 0.834,
      output_per_1m: 2.501
    },
    "thedrummer/cydonia-24b-v4.1": {
      name: "TheDrummer: Cydonia 24B V4.1",
      context_length: 131072,
      input_per_1m: 0.3,
      output_per_1m: 0.5
    },
    "thedrummer/skyfall-36b-v2": {
      name: "TheDrummer: Skyfall 36B V2",
      context_length: 32768,
      input_per_1m: 0.55,
      output_per_1m: 0.8
    },
    "thedrummer/unslopnemo-12b": {
      name: "TheDrummer: UnslopNemo 12B",
      context_length: 1024e3,
      input_per_1m: 0.4,
      output_per_1m: 0.4
    },
    "thinkingmachines/inkling": {
      name: "Thinking Machines: Inkling",
      context_length: 524288,
      input_per_1m: 1,
      output_per_1m: 4.05
    },
    "thinkingmachines/inkling-2-small:free": {
      name: "Thinking Machines: Inkling 2 Small (free)",
      context_length: 1048576,
      input_per_1m: 0,
      output_per_1m: 0
    },
    "thinkingmachines/inkling-small": {
      name: "Thinking Machines: Inkling Small",
      context_length: 524288,
      input_per_1m: 0.45,
      output_per_1m: 1.2
    },
    "thinkingmachines/inkling-small:batch": {
      name: "Thinking Machines: Inkling Small (batch)",
      context_length: 524288,
      input_per_1m: 0.36,
      output_per_1m: 0.96
    },
    "unbiased/pareto-26.10": {
      name: "Pareto 26.10",
      context_length: 1048576,
      input_per_1m: 0.8,
      output_per_1m: 3.2
    },
    "unbiased/pareto-26.9": {
      name: "Pareto 26.9",
      context_length: 262144,
      input_per_1m: 2.5,
      output_per_1m: 7.5
    },
    "undi95/remm-slerp-l2-13b": {
      name: "ReMM SLERP 13B",
      context_length: 6144,
      input_per_1m: 0.3,
      output_per_1m: 0.5
    },
    "upstage/solar-mini4": {
      name: "Upstage: Solar Mini 4",
      context_length: 524288,
      input_per_1m: 0.05,
      output_per_1m: 0.2
    },
    "upstage/solar-pro4": {
      name: "Upstage: Solar Pro 4",
      context_length: 524288,
      input_per_1m: 0.15,
      output_per_1m: 0.6
    },
    "writer/palmyra-x5": {
      name: "Writer: Palmyra X5",
      context_length: 104e4,
      input_per_1m: 0.6,
      output_per_1m: 6
    },
    "x-ai/grok-4.20": {
      name: "SpaceXAI: Grok 4.20",
      context_length: 2e6,
      input_per_1m: 1.25,
      output_per_1m: 2.5
    },
    "x-ai/grok-4.20-multi-agent": {
      name: "SpaceXAI: Grok 4.20 Multi-Agent",
      context_length: 2e6,
      input_per_1m: 1.25,
      output_per_1m: 2.5
    },
    "x-ai/grok-4.3": {
      name: "SpaceXAI: Grok 4.3",
      context_length: 1e6,
      input_per_1m: 1.25,
      output_per_1m: 2.5
    },
    "x-ai/grok-4.3:batch": {
      name: "SpaceXAI: Grok 4.3 (batch)",
      context_length: 1e6,
      input_per_1m: 1,
      output_per_1m: 2
    },
    "x-ai/grok-4.5": {
      name: "SpaceXAI: Grok 4.5",
      context_length: 5e5,
      input_per_1m: 2,
      output_per_1m: 6
    },
    "x-ai/grok-4.6": {
      name: "SpaceXAI: Grok 4.6",
      context_length: 5e5,
      input_per_1m: 2,
      output_per_1m: 6
    },
    "x-ai/grok-4.6:batch": {
      name: "SpaceXAI: Grok 4.6 (batch)",
      context_length: 5e5,
      input_per_1m: 1.6,
      output_per_1m: 4.8
    },
    "x-ai/grok-4.7": {
      name: "SpaceXAI: Grok 4.7",
      context_length: 5e5,
      input_per_1m: 2,
      output_per_1m: 6
    },
    "x-ai/grok-4.7:batch": {
      name: "SpaceXAI: Grok 4.7 (batch)",
      context_length: 5e5,
      input_per_1m: 1.6,
      output_per_1m: 4.8
    },
    "x-ai/grok-build-0.1": {
      name: "SpaceXAI: Grok Build 0.1",
      context_length: 256e3,
      input_per_1m: 1,
      output_per_1m: 2
    },
    "xiaomi/mimo-v2.5": {
      name: "Xiaomi: MiMo-V2.5",
      context_length: 1e6,
      input_per_1m: 0.4,
      output_per_1m: 2
    },
    "xiaomi/mimo-v2.5-pro": {
      name: "Xiaomi: MiMo-V2.5-Pro",
      context_length: 1024e3,
      input_per_1m: 0.48,
      output_per_1m: 1.8
    },
    "xiaomi/mimo-v2.6-flash": {
      name: "Xiaomi: MiMo-V2.6-Flash",
      context_length: 105e4,
      input_per_1m: 0.14,
      output_per_1m: 0.28
    },
    "xiaomi/mimo-v2.6-pro": {
      name: "Xiaomi: MiMo-V2.6-Pro",
      context_length: 105e4,
      input_per_1m: 0.435,
      output_per_1m: 0.87
    },
    "xiaomi/mimo-v2.6-pro-ultraspeed": {
      name: "Xiaomi: MiMo-V2.6-Pro-UltraSpeed",
      context_length: 1048576,
      input_per_1m: 4.35,
      output_per_1m: 8.7
    },
    "z-ai/glm-4.5": {
      name: "Z.ai: GLM 4.5",
      context_length: 131072,
      input_per_1m: 0.6,
      output_per_1m: 2.2
    },
    "z-ai/glm-4.5-air": {
      name: "Z.ai: GLM 4.5 Air",
      context_length: 131072,
      input_per_1m: 0.2,
      output_per_1m: 1.1
    },
    "z-ai/glm-4.5v": {
      name: "Z.ai: GLM 4.5V",
      context_length: 65536,
      input_per_1m: 0.6,
      output_per_1m: 1.8
    },
    "z-ai/glm-4.6": {
      name: "Z.ai: GLM 4.6",
      context_length: 204800,
      input_per_1m: 0.5,
      output_per_1m: 2
    },
    "z-ai/glm-4.6v": {
      name: "Z.ai: GLM 4.6V",
      context_length: 131072,
      input_per_1m: 0.3,
      output_per_1m: 0.9
    },
    "z-ai/glm-4.7": {
      name: "Z.ai: GLM 4.7",
      context_length: 204800,
      input_per_1m: 0.6,
      output_per_1m: 2.2
    },
    "z-ai/glm-4.7-flash": {
      name: "Z.ai: GLM 4.7 Flash",
      context_length: 2e5,
      input_per_1m: 0.0605,
      output_per_1m: 0.4
    },
    "z-ai/glm-5": {
      name: "Z.ai: GLM 5",
      context_length: 204800,
      input_per_1m: 1,
      output_per_1m: 3.2
    },
    "z-ai/glm-5-turbo": {
      name: "Z.ai: GLM 5 Turbo",
      context_length: 202752,
      input_per_1m: 1.2,
      output_per_1m: 4
    },
    "z-ai/glm-5.1": {
      name: "Z.ai: GLM 5.1",
      context_length: 204800,
      input_per_1m: 1.33,
      output_per_1m: 4.18
    },
    "z-ai/glm-5.2": {
      name: "Z.ai: GLM 5.2",
      context_length: 1048576,
      input_per_1m: 7e-3,
      output_per_1m: 6.8
    },
    "z-ai/glm-5.2:batch": {
      name: "Z.ai: GLM 5.2 (batch)",
      context_length: 1048576,
      input_per_1m: 0.527,
      output_per_1m: 1.075
    },
    "z-ai/glm-5.3": {
      name: "Z.ai: GLM 5.3",
      context_length: 1048576,
      input_per_1m: 0.0699,
      output_per_1m: 1.4
    },
    "z-ai/glm-5.3-flash": {
      name: "Z.ai: GLM 5.3 Flash",
      context_length: 1048576,
      input_per_1m: 0.0399,
      output_per_1m: 0.0784
    },
    "z-ai/glm-5.3-flash:batch": {
      name: "Z.ai: GLM 5.3 Flash (batch)",
      context_length: 1048576,
      input_per_1m: 0.047,
      output_per_1m: 0.061
    },
    "z-ai/glm-5.3-flashx": {
      name: "Z.ai: GLM 5.3 FlashX",
      context_length: 1048576,
      input_per_1m: 0.37,
      output_per_1m: 1.25
    },
    "z-ai/glm-5.3-flashx-legal": {
      name: "Z.ai: GLM 5.3 FlashX Legal",
      context_length: 1048576,
      input_per_1m: 0.37,
      output_per_1m: 1.25
    },
    "z-ai/glm-5.3-prime": {
      name: "Z.ai: GLM 5.3 Prime",
      context_length: 1e6,
      input_per_1m: 2.8,
      output_per_1m: 8.8
    },
    "z-ai/glm-5.3:batch": {
      name: "Z.ai: GLM 5.3 (batch)",
      context_length: 1048576,
      input_per_1m: 0.45,
      output_per_1m: 2
    },
    "z-ai/glm-5v-turbo": {
      name: "Z.ai: GLM 5V Turbo",
      context_length: 202752,
      input_per_1m: 1.2,
      output_per_1m: 4
    },
    "~anthropic/claude-fable-latest": {
      name: "Anthropic: Claude Fable Latest",
      context_length: 1e6,
      input_per_1m: 8,
      output_per_1m: 40
    },
    "~anthropic/claude-haiku-latest": {
      name: "Anthropic: Claude Haiku Latest",
      context_length: 1e6,
      input_per_1m: 0.1,
      output_per_1m: 0.5
    },
    "~anthropic/claude-opus-latest": {
      name: "Anthropic: Claude Opus Latest",
      context_length: 1e6,
      input_per_1m: 4,
      output_per_1m: 20
    },
    "~anthropic/claude-sonnet-latest": {
      name: "Anthropic: Claude Sonnet Latest",
      context_length: 1e6,
      input_per_1m: 2,
      output_per_1m: 10
    },
    "~deepseek/deepseek-flash-latest": {
      name: "DeepSeek: DeepSeek Flash Latest",
      context_length: 1048576,
      input_per_1m: 6e-3,
      output_per_1m: 0.5
    },
    "~deepseek/deepseek-pro-latest": {
      name: "DeepSeek: DeepSeek Pro Latest",
      context_length: 1048576,
      input_per_1m: 0.0999,
      output_per_1m: 8
    },
    "~deepseek/deepseek-v4-flash-latest": {
      name: "DeepSeek: DeepSeek V4 Flash Latest",
      context_length: 1048576,
      input_per_1m: 0.0434,
      output_per_1m: 0.3
    },
    "~google/gemini-flash-latest": {
      name: "Google: Gemini Flash Latest",
      context_length: 1048576,
      input_per_1m: 0.75,
      output_per_1m: 3.75
    },
    "~google/gemini-pro-latest": {
      name: "Google: Gemini Pro Latest",
      context_length: 1048576,
      input_per_1m: 2,
      output_per_1m: 10
    },
    "~moonshotai/kimi-latest": {
      name: "MoonshotAI: Kimi Latest",
      context_length: 1048576,
      input_per_1m: 0.1824,
      output_per_1m: 11.0055
    },
    "~openai/gpt-astra-latest": {
      name: "OpenAI: GPT Astra Latest",
      context_length: 105e4,
      input_per_1m: 10,
      output_per_1m: 50
    },
    "~openai/gpt-luna-latest": {
      name: "OpenAI: GPT Luna Latest",
      context_length: 105e4,
      input_per_1m: 0.1,
      output_per_1m: 0.5
    },
    "~openai/gpt-mini-latest": {
      name: "OpenAI: GPT Mini Latest",
      context_length: 4e5,
      input_per_1m: 0.75,
      output_per_1m: 4.5
    },
    "~openai/gpt-sol-latest": {
      name: "OpenAI: GPT Sol Latest",
      context_length: 105e4,
      input_per_1m: 2,
      output_per_1m: 10
    },
    "~openai/gpt-terra-latest": {
      name: "OpenAI: GPT Terra Latest",
      context_length: 105e4,
      input_per_1m: 1,
      output_per_1m: 5
    },
    "~unbiased/pareto-latest": {
      name: "Pareto Latest",
      context_length: 1048576,
      input_per_1m: 0.8,
      output_per_1m: 3.2
    },
    "~x-ai/grok-latest": {
      name: "xAI: Grok Latest",
      context_length: 5e5,
      input_per_1m: 2,
      output_per_1m: 6
    },
    "~z-ai/glm-flash-latest": {
      name: "Z.ai: GLM Flash Latest",
      context_length: 1048576,
      input_per_1m: 0.0399,
      output_per_1m: 0.0784
    },
    "~z-ai/glm-latest": {
      name: "Z.ai: GLM Latest",
      context_length: 1048576,
      input_per_1m: 0.0699,
      output_per_1m: 1.4
    }
  }
};

// src/cli.ts
var version = false ? "dev" : "0.1.0";
var USAGE = "usage: vibe-bill <detect|questions|answer|calc|price|render> | --version\n  calc <path> [--no-questions] [--live-prices]\n  price <path> [<entries.json>]\n  render <path> [--tier N]\n";
var PRICING = loadPricing(pricing_default);
var SNAP = { source: "snapshot", fetched_at: openrouter_snapshot_default.fetched_at, models: openrouter_snapshot_default.models };
function dirArg(path) {
  const root = resolve(path);
  try {
    return statSync4(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}
var json = (v) => JSON.stringify(v, null, 2) + "\n";
function detectAll(root) {
  const d = detect(root);
  for (const id of readConfig(root, PRICING).llm_providers) {
    if (d.services.some((s) => s.id === id)) continue;
    d.services.push({ id, evidence: ["declared in config.json"], confidence: "high", model: null, model_reason: "provider declared by you; no model found in code" });
  }
  return d;
}
function readJson(file, max, label) {
  assertNotEnvFile(file);
  let size = 0;
  try {
    size = statSync4(file).size;
  } catch {
    throw new Error(`cannot read ${label}`);
  }
  if (size > max) throw new Error(`${label} too large`);
  try {
    return JSON.parse(readFileSync6(file, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}
function phase3(cmd, argv) {
  const args = argv.slice(1).filter((a) => a !== "--no-questions");
  const root = args[0] ? dirArg(args[0]) : null;
  if (!args[0] || cmd === "answer" && !args[1]) return { code: 1, out: "", err: `usage: vibe-bill ${cmd === "answer" ? "answer <path> <answers.json>" : "questions <path> [--no-questions]"}
` };
  if (!root) return { code: 1, out: "", err: `${cmd}: not a directory
` };
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
      const val = (k) => {
        const d = k.indexOf(".");
        return n[k.slice(0, d)][k.slice(d + 1)];
      };
      return { code: 0, out: json({ assumed: n.assumed.map((key) => ({ key, value: val(key) })) }), err: "" };
    }
    return { code: 0, out: json({ schema: 1, llm_prices: { source: SNAP.source, fetched_at: SNAP.fetched_at }, questions: pendingQuestions(qs, cfg).slice(0, MAX_QUESTIONS) }), err: "" };
  } catch (e) {
    return { code: 1, out: "", err: `${cmd}: ${e instanceof Error ? e.message : "failed"}
` };
  }
}
function calc(argv, opts) {
  const args = argv.slice(1).filter((a) => !a.startsWith("--"));
  const root = args[0] ? dirArg(args[0]) : null;
  if (!args[0]) return { code: 1, out: "", err: "usage: vibe-bill calc <path> [--no-questions] [--live-prices]\n" };
  if (!root) return { code: 1, out: "", err: "calc: not a directory\n" };
  try {
    const up = join5(root, ".vibe-bill", "out", "usage.json");
    try {
      statSync4(up);
    } catch {
      throw new Error("usage.json not found (run the analysis first)");
    }
    const llm = opts.llm ?? SNAP;
    const d = detectAll(root);
    const usage = parseUsage(readJson(up, 256 * 1024, "usage.json"), d.services.map((s) => s.id).filter((id) => id in LLM_NAMES));
    let cfg = readConfig(root, PRICING);
    const qs = allQuestions(d, PRICING, SNAP);
    const noQ = argv.includes("--no-questions");
    if (noQ) cfg = fillDefaults(cfg, qs);
    else {
      const ids = pendingQuestions(qs, cfg).filter((q) => getValue(cfg, q.id) === void 0).map((q) => q.id);
      if (ids.length) throw new Error(`unanswered questions: ${ids.join(", ")} (run answer, or pass --no-questions)`);
    }
    const bill = billJson(calcBill({ detect: d, config: cfg, usage, assumptions: resolveAssumptions(cfg.assumptions, usage.per_user), pricing: PRICING, llm, now: opts.now ?? /* @__PURE__ */ new Date(), local: readLocal(root, PRICING) }));
    let out = "";
    if (noQ) {
      writeConfig(root, cfg);
      out += "wrote .vibe-bill/config.json\n";
    }
    writeAtomic(join5(root, ".vibe-bill", "out", "bill.json"), bill);
    return { code: 0, out: out + "wrote .vibe-bill/out/bill.json\n", err: "" };
  } catch (e) {
    return { code: 1, out: "", err: `calc: ${e instanceof Error ? e.message : "failed"}
` };
  }
}
function price(argv, opts) {
  const args = argv.slice(1);
  const root = args[0] ? dirArg(args[0]) : null;
  if (!args[0] || args.length > 2) return { code: 1, out: "", err: "usage: vibe-bill price <path> [<entries.json>]\n" };
  if (!root) return { code: 1, out: "", err: "price: not a directory\n" };
  try {
    const now = opts.now ?? /* @__PURE__ */ new Date();
    const hints = detect(root).unknown_services.map((u) => u.hint);
    const cur = readLocal(root, PRICING);
    if (!args[1]) return { code: 0, out: json(listLocal(cur, hints, now)), err: "" };
    const add = parseEntries(readJson(resolve(args[1]), MAX_INPUT, "entries file"), hints, now, PRICING);
    mkdirSync2(join5(root, ".vibe-bill"), { recursive: true });
    writeAtomic(join5(root, ".vibe-bill", "prices.local.json"), canonicalLocal(mergeLocal(cur, add)));
    return { code: 0, out: "wrote .vibe-bill/prices.local.json\n", err: "" };
  } catch (e) {
    return { code: 1, out: "", err: `price: ${e instanceof Error ? e.message : "failed"}
` };
  }
}
function render(argv, opts) {
  const ti = argv.indexOf("--tier");
  const tierArg = ti >= 0 ? argv[ti + 1] : void 0;
  const args = argv.slice(1).filter((a, k) => !a.startsWith("--") && !(ti >= 0 && k === ti));
  const root = args[0] ? dirArg(args[0]) : null;
  if (!args[0]) return { code: 1, out: "", err: "usage: vibe-bill render <path> [--tier N]\n" };
  if (!root) return { code: 1, out: "", err: "render: not a directory\n" };
  try {
    const dir = join5(root, ".vibe-bill", "out");
    const need = (f, msg) => {
      if (!existsSync4(join5(dir, f))) throw new Error(msg);
      return join5(dir, f);
    };
    const bill = parseBill(readJson(need("bill.json", "bill.json not found (run calc first)"), 1024 * 1024, "bill.json"));
    const d = detectAll(root);
    const usage = parseUsage(readJson(need("usage.json", "usage.json not found (run the analysis first)"), 256 * 1024, "usage.json"), d.services.map((s) => s.id).filter((id) => id in LLM_NAMES));
    const users = bill.tiers.map((x) => x.users);
    let t = defaultTier(bill);
    if (ti >= 0) {
      t = tierArg !== void 0 && /^[0-9]+$/.test(tierArg) ? users.indexOf(Number(tierArg)) : -1;
      if (t < 0) throw new Error(`--tier must be one of ${users.join(", ")}`);
    }
    const project = projectName(root);
    const svg = renderReceipt(bill, t, project, brand_default);
    const report = renderReport({ bill, usage, config: readConfig(root, PRICING), detect: d, pricing: PRICING, snap: SNAP, project, tierIdx: t, local: readLocal(root, PRICING) });
    let err = "";
    let png;
    if (opts.png) {
      try {
        png = opts.png(svg);
      } catch {
        err = "receipt.png skipped: render failed\n";
      }
    } else err = "receipt.png skipped: renderer not available\n";
    const files = [["receipt.svg", svg]];
    if (png) files.push(["receipt.png", png]);
    files.push(["receipt.html", renderHtml(svg, !!png)], ["report.md", report]);
    mkdirSync2(dir, { recursive: true });
    for (const [n, c] of files) writeAtomic(join5(dir, n), c);
    const top = topFix(bill, t);
    const summary = `total at ${fmtInt(bill.tiers[t].users)} users: ${money(bill.tiers[t].total)}/month
` + (top?.kind === "fix" ? `top fix: ${top.fix} (saves ${approx(top.saves)}/month)
` : top ? `top risk: ${top.fix} (abuse cost not estimated)
` : "");
    return { code: 0, out: files.map(([n]) => `wrote ${relative(root, join5(dir, n)).split("\\").join("/")}
`).join("") + summary, err };
  } catch (e) {
    return { code: 1, out: "", err: `render: ${e instanceof Error ? e.message : "failed"}
` };
  }
}
function run(argv, opts = {}) {
  const [cmd, path] = argv;
  if (cmd === "--version") return { code: 0, out: version + "\n", err: "" };
  if (cmd === "detect") {
    if (!path) return { code: 1, out: "", err: "usage: vibe-bill detect <path>\n" };
    const root = dirArg(path);
    if (!root) return { code: 1, out: "", err: "detect: not a directory\n" };
    const dir = join5(root, ".vibe-bill", "out");
    mkdirSync2(dir, { recursive: true });
    try {
      writeAtomic(join5(dir, "detect.json"), json(detectAll(root)));
    } catch (e) {
      return { code: 1, out: "", err: `detect: ${e instanceof Error ? e.message : "failed"}
` };
    }
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
  let png, warn = "";
  if (argv[0] === "render") png = await loadPng().catch((e) => {
    warn = `receipt.png skipped: ${e instanceof Error ? e.message.slice(0, 80) : "init failed"}
`;
    return void 0;
  });
  const r = run(argv, live ? { llm: await getLlmPrices({ snapshot: SNAP }) } : { png });
  if (warn) r.err = r.err.replace(/receipt\.png skipped: renderer not available\n/, warn);
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  process.exitCode = r.code;
}
export {
  run,
  version
};
