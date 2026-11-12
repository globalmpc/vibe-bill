# vibe-bill — Spec (contracts)

These are the contracts between modules. If one proves wrong, record a decision and update this file in the same phase.

## 1. Flow

```
detect (script) ──► detect.json
questions (skill asks, script builds) ──► .vibe-bill/config.json
analysis (Claude reads code) ──► usage.json
prices (pricing.json + OpenRouter) ─┐
calculate (script) ◄────────────────┴── detect + config + usage + assumptions
   └──► bill.json ──► render ──► receipt.svg / .png / .html, report.md
```

CLI (bundled to `skills/vibe-bill/scripts/vibe-bill.mjs`):

```
vibe-bill detect    <path>                  # → .vibe-bill/out/detect.json
vibe-bill questions <path>                  # → prints pending questions as JSON
vibe-bill answer    <path> <answers.json>   # → merges into .vibe-bill/config.json
vibe-bill calc      <path> [--no-questions] # → bill.json (needs usage.json)
vibe-bill price     <path> [<entries.json>] # → lists pending/cached unknown-service prices, or records entries in .vibe-bill/prices.local.json
vibe-bill render    <path> [--tier N]       # → receipt + report, prints total + top fix
vibe-bill --version
```

All outputs go under `<path>/.vibe-bill/out/`. Nothing else in the user's project is written.

## 2. `data/pricing.json` (non-LLM services)

```jsonc
{
  "schema": 1,
  "services": {
    "supabase": {
      "name": "Supabase",
      "source_url": "https://…/pricing",
      "checked_at": "2026-11-12",
      "plans": {
        "free": {
          "base_monthly": 0,
          "included": { "mau": 50000, "db_gb": 0.5, "egress_gb": 5 },
          "overage": null,                  // null = hard limit, upgrade needed
          "upgrade_to": "pro"
        },
        "pro": {
          "base_monthly": 25,
          "included": { "mau": 100000, "db_gb": 8, "egress_gb": 250 },
          "overage": { "mau": 0.00325, "db_gb": 0.125, "egress_gb": 0.09 }
        }
      },
      "default_plan": "free",
      "needs_check": false
    }
    // vercel, clerk, resend, stripe …
  }
}
```

The numbers above illustrate the shape only. Real values come from the vendor page in Phase 1.

- Units are a closed list: `mau`, `db_gb`, `storage_gb`, `egress_gb`, `bandwidth_gb`, `function_invocations`, `function_gb_hours`, `emails`, `image_optimizations`, `transactions`, `transaction_volume_usd`.
- Stripe-style fees use `{ "percent": n, "fixed_usd": n }` per transaction.
- If a free plan's limit is exceeded, the calculator moves to `upgrade_to` and says so on the line.

## 3. OpenRouter prices

- Source: OpenRouter public model list (`https://openrouter.ai/api/v1/models`), no API key.
- Its `pricing.prompt` / `pricing.completion` are USD **per token** as strings → store as per-1M-token numbers.
- Matching: provider + model id (e.g. `openai/<model>`); keep a small alias map for SDK model names that differ from OpenRouter ids.
- Result carries `source: "openrouter" | "snapshot"` and `fetched_at`.
- Caveat text (report + assumptions list): *"LLM prices are OpenRouter list rates; direct-API discounts such as prompt caching or batch pricing are not included, so the actual bill may be lower."*

## 4. Detection

**Env names (`src/detect/env-names.ts`)**, the only module allowed to touch real env files:
1. `.env.example` / `.env.sample` / `.env.template`: names (values ignored even there).
2. Code references: `process.env.X`, `process.env["X"]`, `import.meta.env.X`, `os.environ["X"]`, `os.environ.get("X")`, `os.getenv("X")`, `Deno.env.get("X")`.
3. Config files: env key names in `docker-compose*.yml`, `vercel.json`, `netlify.toml`, `wrangler.toml`.
4. Real `.env*` files: parse in-process, keep the part before `=`, discard the rest immediately. Never logged, never returned, never written.

**Services:**

| Service | Evidence (any) |
|---|---|
| OpenAI | `openai` package; `OPENAI_API_KEY` |
| Anthropic | `@anthropic-ai/sdk`, `anthropic`; `ANTHROPIC_API_KEY` |
| Google AI | `@google/genai`, `@google/generative-ai`, `google-genai`; `GEMINI_API_KEY`, `GOOGLE_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY`; base URL flag |
| Vercel AI SDK | `ai`, `@ai-sdk/*` (provider from the `@ai-sdk/<provider>` package) |
| Supabase | `@supabase/supabase-js`, `@supabase/ssr`; `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` |
| Vercel | `vercel.json`, `.vercel/`, `next` without another deploy target (low confidence) |
| Clerk | `@clerk/*`; `CLERK_SECRET_KEY` |
| Resend | `resend`; `RESEND_API_KEY` |
| Stripe | `stripe`, `@stripe/stripe-js`; `STRIPE_SECRET_KEY` |

Anything with an `*_API_KEY` / `*_SECRET*` name not in the table → `unknown_services[]`.

## 5. `detect.json` and `usage.json`

```jsonc
// detect.json (script output)
{
  "schema": 1,
  "services": [
    { "id": "openai", "evidence": ["package:openai", "env:OPENAI_API_KEY"],
      "confidence": "high", "model": null, "model_reason": "set via env OPENAI_MODEL" }
  ],
  "unknown_services": [{ "hint": "env:REPLICATE_API_TOKEN" }],
  "flags": [{ "type": "base_url", "env": "OPENAI_BASE_URL", "service": "openai" }],
  "env_names": ["OPENAI_API_KEY", "OPENAI_MODEL", "SUPABASE_URL"]
}
```

```jsonc
// usage.json (written by the skill's code analysis)
{
  "schema": 1,
  "call_sites": [
    { "service": "openai", "feature": "chat reply",
      "file": "app/chat/page.tsx", "line": 42,
      "trigger": "per_message",          // closed list, see §7.3
      "est_input_tokens": 800, "est_output_tokens": 300,
      "notes": "sends full history each turn" }
  ],
  "traps": [
    { "id": "keystroke_llm_call", "call_site": 0, "fix": "debounce or call on submit" }
  ],
  "per_user": { "emails_per_month": 4, "storage_mb": 20 }
}
```

`file`/`line` appear only in the report's technical notes, never on the receipt.

```jsonc
// .vibe-bill/prices.local.json (user-owned cache; written only by `vibe-bill price`, D-045)
{
  "schema": 1,
  "services": {
    "replicate": {
      "hints": ["env:REPLICATE_API_TOKEN"], "name": "Replicate",
      "source_url": "https://replicate.com/pricing", "checked_at": "2026-11-11",
      "base_monthly": 0, "unit": "image", "unit_price_usd": 0.004, "units_per_user_per_month": 5,
      "unverified": true
    }
  }
}
```

## 6. Questions & config

- At most **4 questions per run, asked in one batch**. Priority: production model > provider behind base URL > plan tier > anything else.
- Question types: `model` (options: that provider's models with $/1M in and out, plus Other), `plan_tier` (options from pricing.json), `base_url_provider` (OpenAI / OpenRouter / Other).
- Wording for model: *"Which model does production use for <feature/provider>?"*
- `.vibe-bill/config.json`:

```jsonc
{
  "schema": 1,
  "models": { "openai": "openai/<model-id>" },
  "plans": { "supabase": "pro" },
  "providers": { "OPENAI_BASE_URL": "openrouter" },
  "assumptions": { "messages_per_active_user_per_day": 12 },
  "assumed": ["plans.vercel"]
}
```

## 7. Calculation

### 7.1 Defaults (`data/assumptions.default.json`)

`tiers: [100, 1000, 10000, 100000]`, `daily_active_ratio: 0.3`, `days_per_month: 30`, `messages_per_active_user_per_day: 10`, `default_input_tokens: 800`, `default_output_tokens: 300`, `emails_per_user_per_month: 4`, `storage_mb_per_user: 20`, `egress_mb_per_active_user_per_day: 5`, `paying_user_ratio: 0.05`, `avg_payment_usd: 10`, plus trap multipliers (§7.3). Each value has a one-line `why`.

### 7.2 Formulas

- Active users per day `A = N × daily_active_ratio`.
- LLM call site: `calls/month = A × days × base_rate(trigger) × multiplier(trap)`; `cost = calls × (in_tokens × p_in + out_tokens × p_out) / 1e6`.
- Metered service: usage per unit from per-user assumptions × N (or × A for activity units) → `base_monthly + Σ max(0, usage − included) × overage`; free-plan overflow → `upgrade_to`.
- Stripe: `transactions = N × paying_user_ratio`; `fee = transactions × (avg_payment × percent/100 + fixed_usd)`.
- Money is rounded **only at render**; computation uses full precision. Totals are sums of unrounded lines.

### 7.3 Triggers and traps (v0.1)

Triggers: `per_message`, `per_page_view`, `per_keystroke`, `per_render`, `per_poll`, `per_cron_run`, `per_webhook`, `per_signup`.

| Trap id | Default multiplier / effect |
|---|---|
| `keystroke_llm_call` | × chars-per-message (default 40) on that site |
| `render_loop_llm_call` | × 5 |
| `unbounded_history` | input tokens grow with turns (default × 4) |
| `top_model_for_trivial_task` | savings = same calls on the cheapest model of that provider |
| `no_prompt_cache` | × 1.3 (repeat calls) |
| `public_ai_endpoint_no_rate_limit` | flagged risk, no number (abuse is unbounded) |
| `aggressive_polling` | × (60 / poll_seconds) on that site |
| `image_optimization_on_uploads` | image_optimizations = uploads × variants |
| `select_all_egress` | egress × 3 |
| `files_in_db` | storage moved from object storage to db_gb |

### 7.4 `bill.json`

Per tier: `lines[] { service, label, plan, amount, unverified?, stale? }`, `total`, `biggest_line`. Plus `traps[] { id, savings_by_tier }`, `key_assumptions[]` (exactly 2–3 strings: user count, the usage driving `biggest_line`, the model), `prices_as_of { llm: {source, date}, other_oldest }`.

## 8. Fixtures

- `fixtures/next-openai-supabase/`: Next.js chat with an LLM call on `onChange` (keystroke trap), Supabase, `.env.example` present.
- `fixtures/express-anthropic-stack/`: Express + Anthropic + Resend + Stripe + Clerk, model as a string literal.
- `fixtures/no-env-example/`: no `.env.example`; names only in code; `OPENAI_BASE_URL` and `OPENAI_MODEL` used; a real `.env` with fake values.
- Fake secret marker format: values contain `FAKESECRET_` + random suffix. The secret test greps all outputs, logs, snapshots and bundles for `FAKESECRET_`.

## 9. Receipt

Tall SVG (width 600, height by content), bundled monospace font, light paper background. Shown tier: 10k users by default (`--tier` to change). Contents, top to bottom:

1. `VIBE BILL — <project name>` (basename of the project folder, sanitised) and `ESTIMATE`.
2. `@ <N> users / month`.
3. Service lines (label, plan, amount); a drawn warning triangle (not a glyph) on lines with a trap; `(unverified)` / `(price may be outdated)` marks.
4. `TOTAL`.
5. Top fix: `<trap fix> → saves ~$X/month` (largest saving), if any.
6. `Assumes: <key assumption 1> · <2> · <3>`.
7. `LLM prices: <source> <date> · Other prices checked <date>`.
8. Two centered rows from `data/brand.json`: the repo URL, then the search line.

Never on the receipt: file paths, line numbers, env names or values, secrets.

## 10. Report (`report.md`)

1. Verdict: Low / Medium / High bill risk, one sentence why.
2. Bill by tier (table).
3. Cost traps, ranked by savings: plain explanation, savings, the fix, a fix prompt to paste into Claude Code.
4. Assumptions: every value used, its source (default / code analysis / config / answered / assumed), and the OpenRouter caveat.
5. Prices: each price used with its source link and date; unverified and stale ones marked.
6. What this estimate can't know (real traffic, negotiated discounts, free credits, services not detected).
7. Technical notes: call sites with file and line (never the free-text `notes`).

## 11. `/vibe-bill` skill (product)

1. Run `detect`.
2. Run `questions`; if any, ask them in **one** multiple-choice batch; save with `answer`. If the user isn't there, skip this. Either way step 5 runs `calc --no-questions`.
3. Read the call sites' code and write `usage.json` (triggers, token estimates, traps). Do not open real `.env*` files.
4. Run `price <path>` (list). For each `pending` unknown service: web search the vendor's pricing page and record price + URL + date with `price <path> <entries.json>` (stored in `.vibe-bill/prices.local.json`, marked unverified); if nothing is pending, do not search.
5. Run `calc --no-questions`, then `render`.
6. Reply with the two summary lines `render` prints (total at 10k users, top fix) and where the files are. Under 8 lines.

## 12. README must contain

Receipt image at the top · one-line install · what it checks · **What it reads / what it never reads** (env names only; no `.env.example` → names from code references; code read by the skill is sent to Claude as part of normal Claude Code use) · how prices work (OpenRouter + pricing file, dates, caveat) · how assumptions work and how to change them · limits · contributing price corrections · license.
