# vibe-bill report: express-anthropic-stack

_Estimate, not an invoice. Shown tier: 10,000 users/month._

## Verdict

**Medium bill risk.** About $0.43 per user per month at 10,000 users; the biggest fixable trap saves ~$3,078/month.

## Bill by tier

| Service | 100 users | 1,000 users | 10,000 users | 100,000 users |
| --- | --- | --- | --- | --- |
| Anthropic: ticket reply ⚠ | $32.40 | $324.00 | $3,240.00 | $32,400.00 |
| Clerk | $0.00 (hobby) | $0.00 (hobby) | $0.00 (hobby) | $1,025.00 (pro) |
| Resend | $20.00 (pro) | $56.00 (pro) | $785.00 (pro) | $8,075.00 (pro) |
| Stripe | $2.95 (standard) | $29.50 (standard) | $295.00 (standard) | $2,950.00 (standard) |
| **Total** | $55.35 | $409.50 | $4,320.00 | $44,450.00 |

## Cost traps

### 1. Top-tier model for a simple task (ticket reply)

A cheaper model of the same provider would do this job for a fraction of the price.

Saves ~$3,078/month at 10,000 users (~$31 / ~$308 / ~$3,078 / ~$30,780 at 100 / 1,000 / 10,000 / 100,000).

**Fix:** Use a Haiku-class model for ticket replies

Prompt for Claude Code:
```text
In this app, the "ticket reply" Anthropic call has a cost problem: top-tier model for a simple task. Use a Haiku-class model for ticket replies. Make the smallest change that fixes it and keep everything else working.
```

## Assumptions

| Assumption | Value | Source | Why |
| --- | --- | --- | --- |
| daily\_active\_ratio | 0.3 | default | DAU/MAU of 20-30% is typical for retained consumer apps; upper end so usage is not understated |
| days\_per\_month | 30 | default | average billing month |
| messages\_per\_active\_user\_per\_day | 10 | default | a short daily chat session; base rate for per\_message and per\_keystroke sites |
| page\_views\_per\_active\_user\_per\_day | 5 | default | a short daily visit: home, app, 2-3 navigations; base rate for per\_page\_view and per\_render sites |
| polls\_per\_active\_user\_per\_day | 20 | default | polling once a minute over ~20 minutes of daily use; aggressive\_polling multiplies this |
| cron\_runs\_per\_active\_user\_per\_day | 1 | default | a daily job that does one call per active user (digest); a fixed job that does not loop over users costs far less, lower it |
| webhooks\_per\_active\_user\_per\_day | 1 | default | one inbound event (message, form, payment) per active user per day |
| signups\_per\_active\_user\_per\_day | 0.01 | default | about 9% of users are new each month (0.01 x 30 days x 30% active) |
| default\_input\_tokens | 800 | default | system prompt plus a few turns of context, used when a call site gives no estimate |
| default\_output\_tokens | 300 | default | a 1-2 paragraph reply, used when a call site gives no estimate |
| emails\_per\_user\_per\_month | 90 | code analysis | welcome, sign-in link, a receipt and one notification |
| storage\_mb\_per\_user | 20 | default | a few uploaded photos or documents (~4 x 5 MB) per user |
| db\_mb\_per\_user | 2 | default | ~90 messages/user/month (0.3 x 30 x 10) x ~2 KB per row incl. indexes, kept about a year |
| egress\_mb\_per\_active\_user\_per\_day | 5 | default | a few dozen API/database JSON responses of ~100 KB per active day |
| bandwidth\_mb\_per\_page\_view | 1 | default | median page weight is ~2 MB but repeat views are mostly browser-cached |
| paying\_user\_ratio | 0.05 | default | freemium conversion is typically 2-5%; upper end so payment fees are not understated |
| avg\_payment\_usd | 10 | default | your own price per payment (not a vendor price); a common entry subscription, edit to yours |
| chars\_per\_message | 40 | default | a short typed question; keystroke\_llm\_call fires once per character |
| render\_loop\_multiplier | 5 | default | a call in a render or effect loop typically fires ~5x per view (state updates, StrictMode double render) |
| history\_input\_multiplier | 4 | default | resending full history over a ~10-turn chat averages ~4x the single-turn input |
| no\_prompt\_cache\_multiplier | 1.3 | default | ~30% of requests repeat an earlier prompt (retries, reloads, identical questions) and could be served from an app cache |
| poll\_seconds | 5 | default | generated UIs usually poll every 2-10 s; aggressive\_polling multiplies by 60 / poll\_seconds |
| uploads\_per\_user\_per\_month | 2 | default | a profile photo plus an occasional image |
| image\_variants | 4 | default | a responsive image is requested at ~4 widths (phone, tablet, laptop, desktop) |
| select\_all\_egress\_multiplier | 3 | default | select('\*') typically returns ~3x the columns a screen needs |

| Choice | Value | Source |
| --- | --- | --- |
| models.anthropic | ~anthropic/claude-sonnet-latest | assumed |
| plans.clerk | hobby | assumed |
| plans.resend | free | assumed |

> LLM prices are OpenRouter list rates; direct-API discounts such as prompt caching or batch pricing are not included, so the actual bill may be lower.

## Prices

LLM: OpenRouter list rates (snapshot), fetched 2026-11-11. https://openrouter.ai/models

| Model | $/1M input | $/1M output |
| --- | --- | --- |
| ~anthropic/claude-sonnet-latest | $2 | $10 |

### Clerk

Source: https://clerk.com/pricing, checked 2026-11-11

- hobby: base $0.00/month
- pro: base $25.00/month; overage mau $0.02

### Resend

Source: https://resend.com/pricing, checked 2026-11-11 **needs check**

- pro: base $20.00/month; overage emails $0.0009

### Stripe

Source: https://stripe.com/pricing, checked 2026-11-11

- standard: base $0.00/month; fee 2.9% + $0.30

## Not modelled

**Clerk**
- Business plan and add-ons

**Resend**
- Scale tiers
- Free plan 100 emails/day cap

**Stripe**
- International cards +1.5%
- Currency conversion +1%
- Billing 0.7%
- Disputes $15

## What this estimate can't know

- Real traffic: user counts and usage per user are assumptions.
- Negotiated discounts.
- Free credits and startup programs.
- Taxes.
- Services that were not detected.

## Technical notes

| # | Feature | Service | Trigger | Location |
| --- | --- | --- | --- | --- |
| 1 | ticket reply | Anthropic | per\_message | `src/server.js:14` |

- top\_model\_for\_trivial\_task → call site #1
