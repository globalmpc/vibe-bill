import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, basename } from "node:path";
import { collectEnvNames, isEnvFile } from "./env-names";

export type Flag = { type: "base_url" | "model_in_env"; env: string; service: string | null };
export type Service = { id: string; evidence: string[]; confidence: "high" | "medium" | "low"; model: string | null; model_reason: string | null };
export type Detect = { schema: 1; services: Service[]; unknown_services: { hint: string }[]; flags: Flag[]; env_names: string[] };

const LLM = new Set(["openai", "anthropic", "google", "openrouter"]);
const SERVICES: { id: string; pkgs: string[]; env: string[]; prefix: string[] }[] = [
  { id: "openai", pkgs: ["openai", "@ai-sdk/openai"], env: ["OPENAI_API_KEY"], prefix: ["OPENAI"] },
  { id: "anthropic", pkgs: ["@anthropic-ai/sdk", "anthropic", "@ai-sdk/anthropic"], env: ["ANTHROPIC_API_KEY"], prefix: ["ANTHROPIC"] },
  { id: "google", pkgs: ["@google/genai", "@google/generative-ai", "google-genai", "google.genai", "google.generativeai", "@ai-sdk/google"], env: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], prefix: ["GEMINI", "GOOGLE"] },
  { id: "openrouter", pkgs: ["@openrouter/ai-sdk-provider"], env: ["OPENROUTER_API_KEY"], prefix: ["OPENROUTER"] },
  { id: "supabase", pkgs: ["@supabase/supabase-js", "@supabase/ssr", "supabase"], env: ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"], prefix: ["SUPABASE"] },
  { id: "vercel", pkgs: [], env: [], prefix: ["VERCEL"] },
  { id: "clerk", pkgs: [], env: ["CLERK_SECRET_KEY"], prefix: ["CLERK"] },
  { id: "resend", pkgs: ["resend"], env: ["RESEND_API_KEY"], prefix: ["RESEND"] },
  { id: "stripe", pkgs: ["stripe", "@stripe/stripe-js"], env: ["STRIPE_SECRET_KEY"], prefix: ["STRIPE"] },
];
// ponytail: hand lists; grow from Phase 7 runs.
const PAID_SDKS = new Set("replicate cohere-ai groq-sdk @mistralai/mistralai together-ai @pinecone-database/pinecone twilio @sendgrid/mail postmark elevenlabs @deepgram/sdk @upstash/redis @vercel/blob @vercel/kv @vercel/postgres firebase firebase-admin algoliasearch @ai-sdk/mistral @ai-sdk/groq @ai-sdk/cohere".split(" "));
const GENERIC = new Set("JWT SESSION NEXTAUTH AUTH BETTER COOKIE ENCRYPTION APP WEBHOOK CRON SECRET".split(" "));
const DEPLOY_FILES = ["netlify.toml", "wrangler.toml", "fly.toml", "render.yaml", "railway.json", "railway.toml", "Dockerfile", "app.yaml", "amplify.yml", "firebase.json"];
const IGNORE = new Set("node_modules .git .vibe-bill .vercel .next .nuxt .svelte-kit .turbo .cache dist build out coverage venv .venv __pycache__ vendor target".split(" "));
const CODE_EXT = new Set(".js .jsx .ts .tsx .mjs .cjs .mts .cts .py .vue .svelte .astro".split(" "));
const MAX = 1024 * 1024;
const MODEL_ENV = /(?:^|_)MODEL(?:_ID|_NAME)?$/;

function walk(root: string, dir = ""): string[] {
  const out: string[] = [];
  let ents;
  try { ents = readdirSync(join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.isSymbolicLink()) continue;
    const rel = dir ? dir + "/" + e.name : e.name;
    if (e.isDirectory()) { if (!IGNORE.has(e.name)) out.push(...walk(root, rel)); continue; }
    try { if (!e.isFile() || statSync(join(root, rel)).size > MAX) continue; } catch { continue; }
    out.push(rel);
  }
  return out;
}

function read(root: string, rel: string): string {
  if (isEnvFile(rel)) throw new Error("refusing env file");
  try { return readFileSync(join(root, rel), "utf8"); } catch { return ""; }
}

function prefixOf(name: string): string {
  return name.replace(/^(NEXT_PUBLIC|VITE|PUBLIC|EXPO_PUBLIC|REACT_APP)_/, "").split("_")[0];
}

function jsSpec(s: string): string | null {
  s = s.replace(/^(npm|jsr):/, "");
  if (/^[./]/.test(s) || s.startsWith("node:")) return null;
  return s.replace(/^(@[^/@]+\/[^/@]+|[^/@]+)[^]*$/, "$1");
}

export function detect(root: string): Detect {
  const files = walk(root);
  const base = (f: string) => basename(f);
  const pkgs = new Set<string>();
  const code = new Map<string, string>();
  for (const f of files) {
    const b = base(f);
    if (isEnvFile(f)) continue;
    if (b === "package.json") {
      try {
        const j = JSON.parse(read(root, f));
        for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) Object.keys(j?.[k] ?? {}).forEach((d) => pkgs.add(d));
      } catch { /* ignore */ }
    } else if (/^requirements.*\.txt$/.test(b)) {
      for (const l of read(root, f).split("\n")) {
        const t = l.trim();
        if (t && !t.startsWith("#")) pkgs.add(t.split(/[\s=<>!~;[]/)[0].toLowerCase());
      }
    } else if (b === "pyproject.toml") {
      for (const m of read(root, f).matchAll(/["']([A-Za-z0-9_.-]+)/g)) pkgs.add(m[1].toLowerCase());
    } else if (CODE_EXT.has(extname(f))) {
      const text = read(root, f);
      code.set(f, text);
      if (extname(f) === ".py") {
        for (const m of text.matchAll(/^\s*(?:import|from) ([\w.]+)/gm)) { pkgs.add(m[1]); pkgs.add(m[1].split(".")[0]); }
      } else {
        for (const m of text.matchAll(/(?:from\s*|import\s*\(?\s*|require\(\s*)["']([^"']+)["']/g)) { const s = jsSpec(m[1]); if (s) pkgs.add(s); }
      }
    }
  }

  const envs = collectEnvNames(root, files, code);
  const envNames = [...new Set(envs.map((e) => e.name))].sort();
  const known = new Set(SERVICES.flatMap((s) => s.prefix));
  const prefixSvc = new Map(SERVICES.flatMap((s) => s.prefix.map((p) => [p, s.id] as const)));

  const flags: Flag[] = [];
  for (const env of envNames) {
    const svc = prefixSvc.get(prefixOf(env));
    const llm = svc && LLM.has(svc) ? svc : null;
    if (/_BASE_URL$|_API_BASE$/.test(env) && llm) flags.push({ type: "base_url", env, service: llm });
    if (MODEL_ENV.test(env)) flags.push({ type: "model_in_env", env, service: llm });
  }
  flags.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.env < b.env ? -1 : a.env > b.env ? 1 : 0));

  const rootFiles = new Set(files.map(base));
  const filesEv = ["vercel.json"].filter((f) => rootFiles.has(f)).map((f) => "file:" + f);
  if (existsSync(join(root, ".vercel"))) filesEv.push("file:.vercel");

  const services: Service[] = [];
  const detected = new Set<string>();
  for (const s of SERVICES) {
    const ev: string[] = [];
    for (const p of pkgs) if (s.pkgs.includes(p) || (s.id === "clerk" && p.startsWith("@clerk/"))) ev.push("package:" + p);
    for (const e of s.env) if (envNames.includes(e)) ev.push("env:" + e);
    if (s.id === "vercel") {
      ev.push(...filesEv);
      if (!ev.length && pkgs.has("next") && !DEPLOY_FILES.some((f) => rootFiles.has(f))) ev.push("package:next");
    }
    if (!ev.length) continue;
    ev.sort();
    const confidence = ev.some((e) => (e.startsWith("package:") && s.id !== "vercel") || e.startsWith("file:")) ? "high" : ev.every((e) => e.startsWith("env:")) ? "medium" : "low";
    services.push({ id: s.id, evidence: ev, confidence, model: null, model_reason: null });
    detected.add(s.id);
  }

  services.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // model literals
  const lits = new Map<string, Set<string>>();
  for (const text of code.values()) {
    for (const line of text.split("\n")) {
      if (!/model/i.test(line)) continue;
      for (const m of line.matchAll(/["'`]([^"'`\s$]{2,80})["'`]/g)) {
        const v = m[1];
        const id = /^(gpt-|o\d|chatgpt-)/.test(v) ? "openai" : v.startsWith("claude-") ? "anthropic" : v.startsWith("gemini-") ? "google" : /^[\w-]+\/[\w.:-]+$/.test(v) ? "openrouter" : null;
        if (id && detected.has(id)) (lits.get(id) ?? lits.set(id, new Set()).get(id)!).add(v);
      }
    }
  }
  for (const s of services) {
    if (!LLM.has(s.id)) continue;
    const l = [...(lits.get(s.id) ?? [])].sort();
    if (l.length === 1) s.model = l[0];
    else if (l.length > 1) s.model_reason = "multiple models in code: " + l.join(", ");
    else {
      const f = flags.find((x) => x.type === "model_in_env" && x.service === s.id);
      s.model_reason = f ? "set via env " + f.env : "no model literal found";
    }
  }

  const unknown = new Set<string>();
  for (const env of envNames) {
    const p = prefixOf(env);
    if (/_API_KEY$|_API_TOKEN$|_SECRET/.test(env) && !known.has(p) && !GENERIC.has(p) && !/_CLIENT_SECRET$/.test(env)) unknown.add("env:" + env);
  }
  for (const p of pkgs) if (PAID_SDKS.has(p)) unknown.add("package:" + p);

  return { schema: 1, services, unknown_services: [...unknown].sort().map((hint) => ({ hint })), flags, env_names: envNames };
}
