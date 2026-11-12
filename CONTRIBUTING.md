# Contributing

The most useful contribution is a price correction.

## Correct a price

1. Edit `data/pricing.json`. Each service has `source_url`, `checked_at` (YYYY-MM-DD), `plans` and `needs_check`. Units are a closed list defined in `src/pricing/schema.ts`; the shape is described in `docs/spec.md` section 2.
2. Set `source_url` to the vendor's own pricing page and `checked_at` to the day you read it. Set `needs_check` to `true` if you are unsure of a figure.
3. Run `npm test` and `npm run typecheck`. The schema test validates the file; the fixture bills in `fixtures/*/expected/` may change if you touch a price they use, so say so in the PR.
4. In the PR, link the vendor page and give the date.

## Refresh the OpenRouter snapshot

`npm run snapshot` fetches the live model list into `data/openrouter-snapshot.json` (network needed). Then run `npm test`; fixture bills pin LLM prices and may need regenerating.

## Add a service

Pointer only: see `docs/spec.md` sections 2 and 4 (price shape and detection evidence) and open an issue first.

## Develop

```bash
npm install
npm run build       # esbuild -> skills/vibe-bill/scripts/ (commit the result)
npm test            # vitest
npm run typecheck   # tsc --noEmit
```

## Secrets

Never commit real env files. Fixtures use fake values with an obvious fake-secret prefix (see `tests/secrets.test.ts`); `npm test -- secrets` checks that none leak into outputs, the bundle or the docs.

## Regenerate the example image

The receipt at the top of the README is the real pipeline output for a temp copy of the fixture, with `usage.json` taken from `fixtures/next-openai-supabase/expected/`. (A temp copy is used so the fixture folder stays free of `.vibe-bill/` files.)

```bash
npm run build
D=$(mktemp -d)/next-openai-supabase
mkdir -p "$D" && cp -r fixtures/next-openai-supabase/. "$D"/ && rm -rf "$D/expected"
mkdir -p "$D/.vibe-bill/out" && cp fixtures/next-openai-supabase/expected/usage.json "$D/.vibe-bill/out/"
node skills/vibe-bill/scripts/vibe-bill.mjs detect "$D"
node skills/vibe-bill/scripts/vibe-bill.mjs calc "$D" --no-questions
node skills/vibe-bill/scripts/vibe-bill.mjs render "$D"
cp "$D/.vibe-bill/out/receipt.png" docs/img/example-receipt.png
cp "$D/.vibe-bill/out/receipt.svg" docs/img/example-receipt.svg
```

The repo URL printed at the bottom of the receipt comes from `data/brand.json`. Dates on the receipt depend on the run date; `tests/release.test.ts` checks that the committed SVG equals a fresh render with a pinned date (2026-11-11). The PNG is only checked for byte-identical output on one machine.
