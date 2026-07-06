---
feature: Portfolio hedge — non-custodial basket (S13)
globs:
  - packages/oracle/src/core/hedge/**
  - packages/oracle/src/core/services/portfolio-hedge.ts
  - packages/oracle/src/core/services/hedge-quote.ts
  - packages/oracle/src/worker/smoke-portfolio-hedge.ts
  - docs/PORTFOLIO-HEDGE.md
  - packages/oracle/test/{hedge-leg,hedge-allocate,portfolio-hedge}.test.ts
updated: 2026-07-06
---

# Portfolio hedge (S13)

Prices a coordinated **basket** of non-custodial hedge legs across many positions
under one budget — the multi-market extension of S9 `hedge-quote`.

## Current state — what's working

- **Green + shipped** on branch `claude/reverent-shirley-ac533f` (commit `7647f2f`,
  hardened by review commit `8301834`). `pnpm gate` passes.
- **Shared economics:** `core/hedge/leg.ts` `priceLeg()` + `stakeForCoverage()` —
  `hedge-quote.ts` was refactored onto it (behaviour-preserving; its 13 tests are
  the guard). Rounding helpers `round2/4/6` now live here.
- **Allocator:** `core/hedge/allocate.ts` `allocatePortfolio()` — two modes:
  *explicit* (each leg has stakeUsd xor coverageUsd; sum, scale down proportionally
  over the cap) and *budget* (one `budgetUsd` split proportional to exposure,
  equal split when no exposures). LLM never sizes; caps do.
- **Service:** `core/services/portfolio-hedge.ts` (registered `portfolio-hedge`,
  price $3). Per-leg resolve→quote→priceLeg; per-leg fail-soft (one bad market =
  one `error`/`no_market` leg, rest price); ALL priceable legs failing upstream →
  throw → escrow refund; catalogue failure → throw. Portfolio aggregates +
  honest same-instrument `correlatedGroups` flag (NO fabricated covariance/VaR).
- Config: `PORTFOLIO_HEDGE_MAX_STAKE_USD` (50), `PORTFOLIO_HEDGE_MAX_LEG_STAKE_USD`
  (10). Pricing row added to `core/pricing.ts` + web `lib/pricing.ts` (→ /docs).
- Demo: `pnpm --filter @hunch/oracle smoke:portfolio-hedge`.

## Key decisions

- Reuse `priceLeg` so hedge-quote and portfolio-hedge agree number-for-number.
- Deliver partial baskets (per-leg statuses) rather than all-or-nothing, EXCEPT
  when nothing priced due to upstream errors → reject so escrow refunds.
- Correlation flag is a grouping only (same market / same token), deduped so a
  same-market pair isn't double-counted as market+token — a token shared across
  DISTINCT markets is still reported (fixed in review commit `8301834`).

## Next steps (optional)

- No live-data web page (stateless service; a fabricated "live portfolio" page
  would break the honesty bar). Worked example lives in /docs + the smoke.
