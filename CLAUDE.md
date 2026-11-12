# vibe-bill

Claude Code skill (`/vibe-bill`) that estimates what a vibe-coded app will cost to run at 100 / 1k / 10k / 100k users, flags code patterns that inflate the bill, and renders a shareable receipt image plus a plain-language report. See [README.md](README.md) for users and [CONTRIBUTING.md](CONTRIBUTING.md) for contributors.

## Product rules (non-negotiable)

1. **Env vars: names only.** Never open, read or print a real `.env`, `.env.local`, `.env.production` or similar file. `.env.example` may be read. Only `src/detect/env-names.ts` may parse real env files, and it must discard values in-process and never log them.
2. **Numbers come from code, not the model.** The LLM produces structured data (`usage.json`); the calculator computes every dollar amount.
3. **Deterministic.** Same `usage.json` + config + prices give identical outputs (byte-identical receipt SVG).
4. **Every price has a source and a date**, and the receipt shows them.
5. **The receipt carries its key assumptions** (user count, usage behind the biggest line, model).
6. **Ask for facts, default the guesses.** Ask what code can't show (production model, plan tier, provider behind a base URL). Usage guesses use visible, editable defaults.
7. **Network use is limited** to the OpenRouter model list and, when needed, web search for prices of services not in `data/pricing.json`.
8. **The receipt never shows** file paths, line numbers, env names or values, or secrets.

## Stack and commands

TypeScript (strict), ESM, Node >= 20. Source in `src/`, bundled with esbuild into `skills/vibe-bill/scripts/vibe-bill.mjs`. The bundle is committed, so rebuild and commit it after changing `src/`, `data/` or `fonts/`.

```bash
npm install
npm run build       # esbuild -> skills/vibe-bill/scripts/
npm test            # vitest
npm run typecheck   # tsc --noEmit
```

Run tests once and non-interactively (`CI=true`, no watch mode). Fixture apps with fake secrets live in `fixtures/`. Record design decisions in `docs/decisions.md`; contracts are in `docs/spec.md`.
