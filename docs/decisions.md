# vibe-bill — Decisions

Append new decisions as `D-0NN`. Don't rewrite old ones; supersede them with a new entry.

## Decided

**D-001 — Product form.** Claude Code skill `/vibe-bill`, TypeScript (strict, ESM), Node ≥ 20, scripts bundled with esbuild and committed so users need no build step.
*Why:* same audience and distribution as vibe-preflight; skill-first worked better than the earlier Rust/CLI plan.

**D-002 — Scope covers the whole stack.** v0.1 services: LLM APIs (OpenAI, Anthropic, Google, OpenRouter, Vercel AI SDK providers), Supabase, Vercel, Clerk, Resend, Stripe.
*Why:* LLM-only overlaps existing tools; full-stack cost is the differentiator.

**D-003 — LLM prices from OpenRouter's public model list** (no API key), with a committed snapshot as offline fallback. Source and fetch date shown on receipt and report. Caveat line about direct-API discounts in the assumptions.
*Why:* single, always-current source for the most volatile prices.

**D-004 — Non-LLM prices in `data/pricing.json`**, each with `source_url` and `checked_at`. Receipt shows the oldest checked date; prices older than 30 days are marked. Corrections welcome as pull requests.
*Why:* deterministic and checkable; staleness visible instead of hidden.

**D-005 — Unknown services priced by web search** at run time, marked "unverified" with source link, cached in the user's `.vibe-bill/prices.local.json`.
*Why:* coverage beyond the pricing file without hurting run-to-run consistency.

**D-006 — Env vars: names only.** Real `.env*` files are never opened by agents; only `env-names.ts` parses them in-process and discards values. Without `.env.example`, names come from code references and config files.
*Why:* trust; users must be comfortable running it.

**D-007 — Ask facts, default guesses.** Ask only what code can't show (production model, provider behind a base URL, plan tier), max 4 questions in one batch, saved in `.vibe-bill/config.json`. Unattended runs use defaults marked "assumed".
*Why:* vibecoders expect one command; questions limited to what changes the bill most.

**D-008 — Numbers come from code.** The model writes structured `usage.json`; the calculator computes all amounts. Same inputs → identical outputs.
*Why:* reproducibility; estimates will be challenged publicly.

**D-009 — Receipt carries its own context:** ESTIMATE label, 2–3 key assumptions (users, main usage driver, model), price-date line, repo URL + "search vibe-bill on GitHub". Never paths, line numbers, env names/values or secrets.
*Why:* the image travels without the report; TikTok viewers can't tap links, so the name must be searchable.

**D-011 — User tiers:** 100 / 1k / 10k / 100k; receipt shows 10k by default.

**D-013 — Development workflow:** `/phase` runner, existing agents analis → implementer → reviewer (+ tester), max 3 review rounds, routine commands without confirmation, never push.

**D-014 — Plan field `usage_credit_usd`.** Extends spec §2: a plan may carry `usage_credit_usd`, usage in USD covered by the base fee (Vercel Pro: $20 credit, no per-unit quotas). The Phase 4 calculator must subtract it from metered overage.
*Why:* Vercel Pro has no included quotas, only a credit; `included` alone can't express it.

**D-015 — Stripe fee lives on the plan** as `plans.<p>.fee = { percent, fixed_usd }` per transaction. Spec §2 named the shape but not the place.
*Why:* keeps one lookup path (service → plan) for every price.

**D-016 — Clerk bills MRU (monthly retained users), stored under unit `mau`.** MRU never exceeds MAU, so this slightly overestimates, the safe direction. Clerk's volume tiers start cheaper above 100k MRU; the flat $0.02 overage is exact for every tier we show (max 100k users).
*Why:* the closed unit list has no `mru`; adding one buys nothing at v0.1 scale.

**D-017 — `overage: null` means hard limit / upgrade needed**, applied to Free/Hobby plans even where the vendor page doesn't literally say so (Supabase Free pauses inactive projects instead of billing). Supabase stays `needs_check: true` for this reason.
*Why:* the calculator must move to `upgrade_to` when a free plan is exceeded (spec §2); modelling overage on Free would invent a price.

**D-018 — The Vercel AI SDK is not a billed service.** `@ai-sdk/<provider>` counts as evidence for that provider's service (`openai`, `anthropic`, `google`; `openrouter` via `@openrouter/ai-sdk-provider`). `ai` alone adds nothing. LLM service ids equal OpenRouter provider prefixes; the other ids equal `pricing.json` keys. A base-URL flag does not create an `openrouter` service: Phase 3 asks.
*Why:* the SDK costs nothing itself; ids must join to pricing and OpenRouter without a mapping table. Refines spec §4's "Vercel AI SDK" row.

**D-019 — `unknown_services` rule.** An env name matching `_API_KEY$`, `_API_TOKEN$` or `_SECRET`, whose vendor prefix (after stripping `NEXT_PUBLIC_`/`VITE_`/`PUBLIC_`/`EXPO_PUBLIC_`/`REACT_APP_`) is neither a known service nor a generic app secret (`JWT, SESSION, NEXTAUTH, AUTH, COOKIE, ENCRYPTION, APP, WEBHOOK, CRON, SECRET`), becomes `{hint:"env:<NAME>"}`. Paid-looking SDKs from a hand list become `{hint:"package:<name>"}`. There is no `unknown_sdk` flag type.
*Why:* spec §4's rule missed its own §5 example (`REPLICATE_API_TOKEN`), and `STRIPE_WEBHOOK_SECRET` / `JWT_SECRET` must not show up as paid services. Supersedes the plan's "unknown paid-looking SDKs" under Flags.

**D-020 — `detect.json` details.** Evidence formats `package:` / `env:` / `file:<basename>`. Confidence: high = package or file evidence, medium = env only, low = Vercel via `next` only. Every service carries all 5 keys; `model`/`model_reason` are null for non-LLM services and for resolved models. `model_reason` is one of `set via env <NAME>` / `no model literal found` / `multiple models in code: a, b`. Flags are a closed list (`base_url`, `model_in_env`), shape `{type, env, service|null}`. All arrays use code-unit sorting.
*Why:* spec §5 shows one example only; Phase 3 consumes these fields.

**D-021 — Secret test design.** Prefix grep (`FAKESECRET_`) over every output, captured log and the bundle, plus a value-level canary that the test generates itself in a temp dir. No test reads a real env file; only `env-names.ts` does, through `detect`. A static test keeps every other `src/` file free of `.env` literals.
*Why:* value-level strength without breaking Rule 1 (a test reading the fixture `.env` would be a second env parser).

**D-022 — OAuth client secrets are not paid services.** Env names ending `_CLIENT_SECRET` never become `unknown_services`; `BETTER` joins the generic-secret prefixes (`BETTER_AUTH_SECRET`). Refines D-019.
*Why:* GitHub/Discord/Google OAuth apps are free. The rare paid IdP (Auth0) is an accepted miss.

**D-023 — Question/answer contract.** Question id = config key path (`models.<svc>`, `plans.<svc>`, `providers.<ENV>`). `questions` prints `{schema, llm_prices, questions[]}`, each question `{id, type, service, prompt, note, options[{value, label, description, input_per_1m?, output_per_1m?}], other, default}`. "Other" is a flag, not an option. `answers.json` is a flat `{id: value}`, validated all-or-nothing; errors carry field paths, never values. `questions` runs detect in-process rather than reading `detect.json`.
*Why:* one id everywhere (question, answer, `assumed`); maps 1:1 onto a multiple-choice tool. Spec §6 named the types but no shapes.

**D-024 — Model options and defaults.** Options are the resolved code literal, then OpenRouter's `~<provider>/…-latest` family pointers sorted by price (all `~` ids for `openrouter`), at most 4. Default = the resolved literal, else the lower-median shown pointer. Config model ids may therefore start with `~`, which amends spec §6's `"<provider>/<model-id>"`.
*Why:* a vendor-maintained current lineup with no hand-kept list; the median avoids both lowballing and alarming defaults.

**D-025 — Questions show snapshot prices.** The question builder uses the committed OpenRouter snapshot (source and date in `llm_prices`); only the calculator fetches live prices.
*Why:* the question asks which model, prices are a hint; keeps `questions` sync, offline and deterministic.

**D-026 — Pending and unattended semantics.** A question is pending when its key is absent from config or listed in `assumed`; answered keys are never re-asked; overflow beyond 4 stays pending for the next run. Unattended mode is `questions <path> --no-questions` in Phase 3 (fills absent keys with defaults: plan `default_plan`, base-URL provider = the flag's own service, model per D-024; lists every assumed key and value). Phase 4's `calc --no-questions` reuses the same function. Single-plan services are never asked or written.
*Why:* spec §1/§6 put the flag on `calc`, which doesn't exist until Phase 4. Re-asking assumed keys stops unattended guesses from silently becoming facts.

**D-027 — Config location and safety.** `.vibe-bill/config.json` sits beside `out/`, not inside it (amends spec §1's "all outputs under out/": config is user-owned input, as CLAUDE.md already says). An invalid, oversized or foreign config is an error and is never overwritten. Writes are canonical (sorted keys, 2-space JSON, trailing newline) via temp file and rename.
*Why:* the user may commit and edit the file; silently replacing it would lose data.

**D-028 — `calc` I/O and LLM price source.** `calc` reads detect (in-process), config, the required `.vibe-bill/out/usage.json`, assumption defaults plus `config.assumptions`, pricing.json and LLM prices. It prices LLMs from the committed snapshot by default; `--live-prices` fetches OpenRouter (falling back to the snapshot) and the source and date go in `prices_as_of`. Without `--no-questions`, unanswered question ids are an error. Nothing is written unless every input validates. `run(argv, {llm, now})` stays sync; only the entry block awaits.
*Why:* Rule 3: reruns and tests stay byte-identical and offline; freshness is one flag away.

**D-029 — `bill.json` shape and numbers.** Amends spec §7.4: `key_assumptions` and `biggest_line` (an index into the tier's lines) are per tier; lines carry optional `upgraded_from`, `traps`, `unpriced` (amount null), `unverified`, `stale`; traps carry `call_site`, `fix`, `savings_by_tier` (null for flagged-only); `prices_as_of` is `pricesAsOf()` output; plus `assumptions`, `assumption_sources`, `assumed`. Numbers are serialized at 1e-6 precision (serialization only, not money rounding); totals are fixed-order sums of unrounded lines.
*Why:* user count and top line differ per tier; byte-identical output needs a defined serialization.

**D-030 — `usage.json` contract.** Call sites are LLM-only and must name a detected LLM service; token estimates are optional. App-wide traps (`image_optimization_on_uploads`, `select_all_egress`, `files_in_db`) use `call_site: null`. `feature` and `fix` are limited to a charset without `/ . _` because they print on the receipt. `file`/`line`/`notes` never leave usage.json. Precedence: config > usage.per_user > default.
*Why:* trust boundary (usage.json is model-written and hand-editable); Rule 8.

**D-031 — Assumption and unit mapping.** Amends spec §7.1. Each trigger's base rate is a flat assumption key; new keys include `db_mb_per_user`, `bandwidth_mb_per_page_view`, per-trigger daily rates, `uploads_per_user_per_month`, `image_variants`. GB = 1000 MB. Vercel invocations = page views + LLM calls; Vercel function GB-hours are not modelled. `no_prompt_cache` x1.3 means app-level repeat calls (list prices already exclude provider caching). "Cheapest model of that provider" = the cheapest `~<provider>/` pointer for that site's tokens. Traps stack multiplicatively; savings = total with all traps minus total without that one, never negative, not additive.
*Why:* spec §7.2/§7.3 leave these undefined.

**D-032 — Plan upgrade and usage credit.** A plan with `overage: null` is exceeded when any included unit's usage is strictly above its quota; the calculator follows `upgrade_to` and records `upgraded_from`. Amount = `base + max(0, sum of overage - usage_credit_usd)`.
*Why:* implements D-014/D-017 precisely.

**D-033 — LLM price staleness.** `pricesAsOf().llm.stale` is true when the snapshot or fetch date is older than 30 days (same rule as D-004); `now` is injectable.
*Why:* closes Phase 1 R1-1; the receipt needs it.

**D-034 — `plans.<svc> = "none"`.** Accepted for any priced service, offered as "not used" only for low-confidence services, and drops the service's line.
*Why:* `next` alone doesn't prove Vercel; a phantom line costs credibility.

**D-035 — File safety.** Every JSON read (answers, config, usage) refuses a path whose name or realpath is an env file. Every write goes through remove-tmp, exclusive create, rename.
*Why:* closes Phase 3 R1-1/R1-2 (Rule 1).

**D-036 — Unknown services and not-modelled items stay out of `bill.json`.** Phase 6 adds unknown-service lines from `prices.local.json`; the Phase 5 report keeps a static per-service "not modelled" list.
*Why:* no invented numbers and no bill fields without a consumer yet.

**D-037 — PNG via `@resvg/resvg-wasm` 2.6.2 (supersedes D-010).** Exact-pinned devDependency (bundled; MPL-2.0, file-level copyleft: the unmodified wasm ships with its licence text as `resvg-wasm.LICENSE.txt`, taken from the SPDX text because the npm package has no LICENSE file). `scripts/build.mjs` copies `resvg.wasm`, the font and both licences next to `skills/vibe-bill/scripts/vibe-bill.mjs`; `src/render/png.ts` finds them through `import.meta.url` (no base64, no network). Rendered at 2x width (1200 px) from the bundled font only (`loadSystemFonts: false`). Spike outcome: bundles with esbuild, two renders byte-identical on this machine; cross-platform identity is not claimed (the SVG is the byte-identical contract). If PNG init fails at run time, `render` still writes SVG, HTML and report, prints `receipt.png skipped: <reason>` to stderr and exits 0. Adds ~2.5 MB wasm + ~0.3 MB font to the repo.
*Why:* a receipt is shared as an image; users should not have to screenshot. Feeds the licence decision D-012 (MIT project, MPL-2.0 component).

**D-038 — Font: Liberation Mono Regular (OFL 1.1).** `fonts/LiberationMono-Regular.ttf`, fontversion 137625, sha256 `47ed5b5fcfe6b3c9228937b05de9c769f5fa55b777d539af0f65172f0a24c90b`, licence in `fonts/LICENSE-LiberationMono.txt`. Unmodified, Regular weight only (emphasis by size, never `font-weight`). Covers —, · and →; it has no ⚠, so the warning mark is drawn (D-039). SVG font stack is a constant `'Liberation Mono','Cousine','Courier New',monospace`.
*Why:* OFL, installed offline, metric-compatible with Courier New so the character grid holds even on fallback.

**D-039 — Receipt layout.** 600 px wide, 32 px margins, integer coordinates, no text measuring: a 54-column grid at 16 px (44 at 20 px for title/TOTAL), amounts right-aligned. Lines sorted by amount (unpriced last); more than 8 → top 7 plus `Other (k lines)`. Warning mark = drawn triangle with a two-rect "!" (no font dependency). Money rounds only here (`money`, `approx`; no `Intl`/`toLocaleString`). Top fix = largest saving at the shown tier, else `Top risk` for flagged-only traps, else omitted. Brand prints as two centred rows (amends spec §9.8's single line). `--tier N` must equal one of the bill's tiers; default 10k (D-011). Bill/usage-derived strings go only into XML text nodes through `esc()`.
*Why:* deterministic, byte-identical SVG (Rule 3); Rule 8.

**D-040 — Brand and project name.** `data/brand.json` = `{repo_url, search}` with the placeholder `github.com/OWNER/vibe-bill` until O-1 is decided (Phase 7 replaces it). Project name = `basename(root)`, filtered to `[A-Za-z0-9 ._-]`, max 30 chars, fallback `my app`; never a path, never package.json.
*Why:* spec §9.1 wants a name; the basename leaks nothing the user has not already chosen to name the folder.

**D-041 — `render <path> [--tier N]`.** Reads `bill.json` (validated by `parseBill`, path-only errors), `usage.json` (same safe reader and validator as `calc`), config and detect; writes `receipt.svg`, `receipt.png`, `receipt.html` (SVG inline, relative PNG link, no scripts or external resources) and `report.md` via `writeAtomic` (now accepts bytes), nothing unless every input validates. `run()` stays sync; the entry block awaits `loadPng()` and passes it in (same pattern as `--live-prices`). Spec §1 now lists `--tier`.
*Why:* the receipt must match the `bill.json` the user has, including after a `--live-prices` calc.

**D-042 — Report contract.** Amends D-030 and spec §10.4/§10.7: call-site `file` and `line` appear only in the report's Technical notes (call sites numbered from 1, paths in a code span with control characters stripped); `notes` never leaves usage.json. Verdict at 10k: High if cost/user ≥ $1.00 or a public-AI-endpoint trap exists; Medium if ≥ $0.10 or any trap saves money; else Low. Assumption sources: default / code analysis / config; choices answered / assumed. A fixed catalogue explains all 10 traps with a paste-ready prompt (no paths). A static per-service "Not modelled" list carries the Phase 1/4 omissions. The OpenRouter caveat is verbatim from spec §3.
*Why:* reports are shared; paths belong where the owner expects them and nowhere else.

**D-043 — Skill packaging.** `skills/vibe-bill/SKILL.md` with `allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/vibe-bill.mjs *)`. Every CLI call is unquoted, one per Bash call, no `&&`/pipes/redirects. Write is not granted: the user approves the 1-3 file writes under `.vibe-bill/`. No plugin manifest (O-2 stays open).
*Why:* `${CLAUDE_SKILL_DIR}` is the documented, install-independent path; a broader `node *` grant would allow any script.

**D-044 — Question flow.** Attended: `questions` then one AskUserQuestion call (one question per entry, labels mapped back to values, no "Other" added by the skill), `answer`, then **always** `calc <P> --no-questions` (plain `calc` fails when more than 4 questions are pending; leftovers become `assumed` and are asked next run, D-026). Unattended (`--no-questions` or no AskUserQuestion): skip `questions`/`answer`.
*Why:* Rule 6, and the 4-question cap would otherwise break `calc`.

**D-045 — `.vibe-bill/prices.local.json` and `vibe-bill price`.** User-owned file beside `config.json`: `services.<id> {hints, name, source_url, checked_at, base_monthly, unit, unit_price_usd, units_per_user_per_month, unverified: true}`, strict field regexes and caps (50 entries, 64 KiB). `price <path>` lists `pending` hints and `cached` entries (stale = more than 30 days, D-004); `price <path> <entries.json>` records 1..10 entries all-or-nothing with path-only errors, env-file refusal (D-035) and atomic canonical writes. An id may not be a `pricing.json` service or an LLM id; a hint may not sit under two ids; an invalid existing file is never overwritten.
*Why:* D-005 needs a cache; the CLI protects a user-owned file from model rewrites and does the staleness arithmetic.

**D-046 — Pricing a web-searched price.** `amount(N) = (base_monthly ?? 0) + N x units_per_user_per_month x unit_price_usd`; both base and unit price null gives an `unpriced` line. Free tiers and included quotas are ignored (overestimates, the safe direction; `ponytail:` in code, add `included_units` when needed). The model records only the vendor's published numbers plus one visible usage guess; the calculator computes every dollar (Rule 2).
*Why:* most unknown services are usage-priced, and a flat fee would hide scaling.

**D-047 — Unknown-service lines.** Supersedes the first sentence of D-036. Each used entry (a hint is in the current `unknown_services`) adds one `unverified` line per tier after the detected-service lines, sorted by id; totals include it. `pricesAsOf` takes the used entries so `other_oldest` and `stale` cover them. Receipt: existing `(unverified)` mark only, never a URL, hint or env name. Report: a Prices block per entry with the source link, date and `unverified` mark, and "Detected but not priced" drops covered hints.
*Why:* Rule 4 and the plan's "unverified with its source link".

**D-048 — `render` prints a code-computed summary.** After the `wrote` lines: `total at <N> users: $X/month`, then `top fix: ... (saves ~$Y/month)` or `top risk: ...`, via one shared `topFix()` used by the receipt too. The skill copies these lines verbatim.
*Why:* Rule 2; no model-side rounding or argmax.

**D-049 — Env safety while the skill reads code.** The skill never reads, greps or cats a `.env*` file except `.env.example`/`.sample`/`.template`; every Grep sets `type` or a source-extension `glob`; no Bash besides the vibe-bill commands; env names come from `detect.json` only. No PreToolUse guard hook in v0.1 (hook path substitution is undocumented); add one if a run leaks or the docs confirm it.
*Why:* Rule 1.

**D-050 — Skill price source.** The skill runs `calc` on the committed snapshot and adds `--live-prices` only when the user asks. *Why:* questions and calc show the same prices, and the report keeps its per-model rate table.

**D-051 — Phase 5 report carry-overs folded in.** Trap title keeps its capital when the second letter is also upper case (`LLM call...`); rates print fixed-point without exponent (`$0.0000006`); "Saves about ~$X" became "Saves ~$X". Report goldens regenerated; only those three changes differ.

**D-052 — README example receipt.** `docs/img/example-receipt.{svg,png}` is the real pipeline run on a temp copy of `fixtures/next-openai-supabase` with `now` pinned to 2026-11-11; the README labels it an example from a fixture. A test re-renders the fixture and requires the committed SVG to be byte-identical, so the image cannot drift from the code. The README documents the regeneration command.
*Why:* Rule 3 applied to marketing: the picture at the top must be what the tool really prints.

**D-053 — Third-party notices.** `THIRD_PARTY_NOTICES.md` lists the shipped third-party files in `skills/vibe-bill/scripts/`: resvg-wasm 2.6.2 (MPL-2.0, unmodified wasm plus licence text) and Liberation Mono (OFL 1.1, unmodified). A test asserts every file the notice names exists. No LICENSE file is added; the README says the project licence is TBD (D-012 stays open).
*Why:* MPL-2.0 and OFL require the notices to travel with the files; the project licence is the owner's call.

**D-054 — `OWNER` placeholder strategy.** `OWNER` in `data/brand.json` (O-1) stays a deliberate placeholder. A test keeps its occurrences to an allow-list so none leaks elsewhere, and the README documents one `grep | sed` command plus `npm run build` to replace it (it also lives in the bundle, the example SVG and the fixture receipt goldens; the example PNG is regenerated by hand).
*Why:* the owner can finish O-1 in one step without hunting for places.

## Proposed (confirm or replace during the named phase)

**D-010 — PNG rendering (superseded by D-037)** via `@resvg/resvg-wasm` with a bundled OFL monospace font (e.g. JetBrains Mono or IBM Plex Mono). *Verify in Phase 5* that it bundles and renders identically across platforms. Fallback: ship SVG + HTML only and record a new decision.

**D-012 — License: MIT.** Simple and permissive. Confirmed by the owner; `LICENSE` added. The MPL-2.0 resvg wasm and OFL font keep their own licences (THIRD_PARTY_NOTICES.md).

## Open items (owner)

- **O-1 — Repo account.** Which GitHub account/org hosts vibe-bill? If it's one where the owner has write access, repo traffic (Insights → Traffic → Referring sites) becomes available for Reddit measurement. Needed for `data/brand.json` before Phase 5 output is final.
- **O-2 — Distribution / install method.** Same way as vibe-preflight (plugin marketplace vs. copying the skill folder). Needed before Phase 7.
- **O-3 — Public repos for real runs** in Phase 7 (2–3, owner's choice; public and licensed, results anonymised if shared).

**D-055 — User counts are configurable.** `assumptions.tiers` in `.vibe-bill/config.json` (1 to 6 whole numbers, 1 to 1e9, deduped and sorted) overrides the four default tiers from `data/assumptions.default.json`; it reverses the "fixed tiers" part of D-011. `resolveAssumptions` returns the tier list and `calcBill` reads it from there. The receipt tier is still 10,000 when listed, else the largest. SKILL.md step 5 tells Claude to write the key when the user asks for specific counts. Default bills are unchanged (fixtures byte-equal).

**D-056 — Declared LLM providers.** `llm_providers` in `.vibe-bill/config.json` (subset of openai, anthropic, google, openrouter; omitted from the file when empty) adds providers that `detect` cannot see (proxy, gateway, CLI). `detectAll` in `src/cli.ts` merges them into `detect.json` as `confidence: high`, evidence `declared in config.json`, so the model question and `calc` accept call sites for them. Reason: an app behind a proxy has no SDK or env name, and `calc` refused every call site. SKILL.md step 1 asks (attended) or stops with the config line to add (unattended). Env names are still never read from values; no new network use.
