# S13 — Portfolio Hedge ("hedge a book, not just a bet")

**Status:** approved design · **Date:** 2026-07-06 · **Sprint:** S13

Part of the S11→S14 roadmap (track-record → observability → **portfolio hedge**
→ Python SDK). S9's `hedge-quote` prices ONE hedge on ONE market. S13's
`portfolio-hedge` prices a coordinated **basket** of non-custodial hedge legs
across MANY positions, sized within one deterministic budget — the desk pricing a
whole book's downside, not a single bet.

## The problem it kills

An agent rarely holds one position. It holds a *book* — long $AIXBT, long $SOL,
short a ladder — and wants to spend a fixed premium to cap the book's downside.
`hedge-quote` makes it call the desk N times and do its own budget arithmetic
(and there's no one place that says "these two legs are the same token — don't
treat them as independent"). `portfolio-hedge` takes the whole book in one order,
allocates a single budget across the legs by a deterministic rule, prices each
leg off the live book, and returns portfolio-level aggregates plus a
ready-to-sign trade call per leg — still touching none of the caller's funds.

## Scope

In scope:
- Extract the per-leg economics from `hedge-quote` into a shared pure module so
  both services compute identical numbers (DRY; S9 refactored to consume it, its
  13 tests stay green byte-for-byte).
- A deterministic **budget allocator** across positions (two input modes:
  explicit per-leg size, or a single `budgetUsd` split proportional to exposure).
- A `portfolio-hedge` CAP service: match each position → live quote → priced leg,
  with **per-leg fail-soft** (one bad market doesn't sink the basket) and
  portfolio aggregates.
- An **honest correlation flag** (deterministic): legs sharing a market or token
  are grouped and labelled "not independent" — no fabricated covariance number.
- Pricing row + config cap + `/docs` entry + `smoke:portfolio-hedge` +
  `docs/PORTFOLIO-HEDGE.md` + README section.

Out of scope: real covariance/VaR modelling (we don't have a returns series — we
refuse to invent one); auto-execution (non-custodial — the desk never places the
trades); cross-market netting beyond the same-instrument correlation flag.

## Architecture

Fits `ports`/`adapters`/`core`. New pure logic under `core/hedge/`; the service
under `core/services/`. Reuses the S9 matcher (`matchQuestion`), the Hunch quote
read, and `confidenceFor`.

### Refactor first — shared leg economics `core/hedge/leg.ts`

Pull the money math out of `hedge-quote` into one pure function so it has exactly
one implementation:

```ts
export interface LegInputs {
  priceCents: number;   // marginal price of the hedged outcome
  feeBps: number;       // market fee
  defaultTicketUsd: number;
  rawStakeUsd: number;  // requested premium before the cap
  maxStakeUsd: number;  // deterministic per-leg cap
}
export interface LegEconomics {
  stakeUsd: number; feeUsd: number; feeBps: number; netUsd: number; shares: number;
  payoutIfWinUsd: number; profitIfWinUsd: number; returnMultiple: number;
  breakevenProbability: number; maxStakeUsd: number; capApplied: boolean; belowMinTicket: boolean;
}
export function priceLeg(inputs: LegInputs): LegEconomics;

// coverage → stake back-solve, shared too:
export function stakeForCoverage(coverageUsd: number, price: number, feeRate: number): number;
```

- Identical rounding to S9 (`round2`/`round4`/`round6`) — moved here and imported
  back by `hedge-quote`. This is the invariant that keeps S9's golden numbers.
- `hedge-quote.ts` shrinks to: resolve market/outcome/price (unchanged) → build
  `LegInputs` → `priceLeg(...)` → assemble its existing payload. No behavioural
  change; its test file is the regression guard.

### Allocator — `core/hedge/allocate.ts`

```ts
export interface PositionAllocation { index: number; stakeUsd: number; source: "explicit" | "proportional"; }
export function allocatePortfolio(
  positions: Array<{ stakeUsd?: number; coverageUsd?: number; exposureUsd?: number; priceForCoverage?: number; feeRateForCoverage?: number }>,
  opts: { budgetUsd?: number; totalCapUsd: number },
): { allocations: PositionAllocation[]; requestedTotalUsd: number; scaledBy: number; capApplied: boolean };
```

Deterministic rules (no LLM sizes anything):
- **Explicit mode** (each position gives `stakeUsd` xor `coverageUsd`): compute
  each requested stake (coverage back-solved via `stakeForCoverage`), sum. The
  effective budget is `min(sum, budgetUsd ?? ∞, totalCapUsd)`. If the sum exceeds
  the budget, every leg is scaled by `scaledBy = budget / sum` (proportional
  de-risk) — the shape of the book is preserved, the total is honoured.
- **Budget mode** (`budgetUsd` set, positions carry `exposureUsd`, no per-leg
  size): allocate `budget × exposure_i / Σexposure` to each leg, then clamp the
  total to `totalCapUsd` (scaling again if needed). Positions with no exposure
  get an equal residual share, documented.
- `scaledBy < 1` ⇒ `capApplied`/budget-bound flagged in the payload.

### Service — `core/services/portfolio-hedge.ts`

Input (zod):

```ts
{
  positions: Array<{
    marketSlug?: string; question?: string; token?: string; type?: string; horizonDays?: number;
    side?: "yes" | "no"; outcome?: string;         // exactly one, per position (as S9)
    stakeUsd?: number; coverageUsd?: number;        // explicit mode (xor)
    exposureUsd?: number;                           // budget mode (the downside to cover)
    label?: string;                                 // caller's tag for the leg
  }>,               // 1..20 positions
  budgetUsd?: number,   // total premium to spend (optional; enables budget mode)
}
```

Flow:
1. Validate (≥1 position; each has a market ref and exactly one of side/outcome;
   the *portfolio* is consistently in explicit XOR budget mode — mixing is a
   validation error with a clear message).
2. Read the catalogue **once** (shared provenance). A catalogue read failure
   throws → order rejected → escrow refunds (fail-soft at the source level).
3. For each position: resolve market (slug or `matchQuestion`, same as S9). A
   non-match becomes a leg with `status: "no_market"` + a `spawnHint` (parity
   with `hedge-quote`); it contributes $0 and is excluded from aggregates.
4. Live `quote(marketId)` per matched market (dedup identical marketIds to one
   read). A per-market quote throw → leg `status: "error"` (logged advisory),
   others proceed.
5. Allocate the budget across the *priceable* legs (`allocatePortfolio`), then
   `priceLeg(...)` each with the allocated stake and the per-leg cap
   (`min(maxLegStakeUsd, allocated)`).
6. Assemble: per-leg `{ market, hedge, plan, execute, context }` (same shape as a
   single `hedge-quote`) + portfolio aggregates + correlation groups.

Top-level status: `ok` if ≥1 leg priced; `no_market` if none matched; a thrown
error only for input/`catalogue` failures (→ refund). This mirrors S9's
`ok`/`no_market` contract, extended per-leg.

Portfolio aggregates (deterministic):
`totalPremiumUsd`, `totalPayoutIfAllHitUsd`, `totalExposureUsd` (when provided),
`coverageRatio` (payout/exposure, when exposure given), `budgetUsd`,
`budgetCapUsd`, `scaledBy`, `capApplied`, `pricedLegs`, `skippedLegs`.

Correlation flag: group priceable legs by `marketId` and by `tokenSymbol`; any
group with >1 leg is reported as `correlatedGroups: [{ key, kind: "market"|"token", legIndexes }]` with a note that these legs move together and the basket's true downside is *less* diversified than N independent legs. No number is invented.

### Config + pricing

- `PORTFOLIO_HEDGE_MAX_STAKE_USD` (default 50) — the total-budget cap; the LLM
  never sizes the basket, this does.
- `PORTFOLIO_HEDGE_MAX_LEG_STAKE_USD` (default = `HEDGE_QUOTE_MAX_STAKE_USD`) —
  per-leg cap so one leg can't eat the whole budget.
- `SERVICE_PRICING["portfolio-hedge"]` — listing "Hunch Market Desk", `priceUsd:
  3`, `slaMinutes: 10`. Registered `portfolio-hedge` in the worker `HANDLERS`.

> **Back-reference (S12):** because `portfolio-hedge` is registered by handler
> name and has a `SERVICE_PRICING` row, every delivered basket is automatically
> counted in S12's `oracle_orders_delivered_by_service_total{service="portfolio-hedge"}`
> and its `oracle_revenue_usd` line — no metrics code changes.

### Web + docs

- `apps/web/src/app/docs/page.tsx`: add the `portfolio-hedge` service entry
  (summary, input schema, example) alongside the others, and the pricing row
  flows in automatically from `SERVICE_PRICING`.
- No live-data page (the service is stateless — a fabricated "live portfolio"
  page would violate the honesty bar). The worked example lives in the docs entry
  and the smoke output.

## Honesty & safety invariants

- **Non-custodial.** Every leg is a plan with a `/api/partner/trade` call and
  `custody: "none"`; the desk holds no funds, sets no payout address, places no
  order.
- **The LLM never sizes.** A deterministic allocator + per-leg/total caps do.
  Over-budget requests are scaled proportionally, never silently honoured.
- **No fabricated risk math.** We report exposure, premium, payout, coverage
  ratio, and an honest same-instrument correlation flag — never an invented
  covariance/VaR.
- **Per-leg fail-soft, order-level fail-soft.** A bad market degrades one leg;
  a catalogue/validation failure rejects the order so escrow refunds. Never fake
  a leg.
- **No claimed edge.** The book price *is* the desk's probability; the basket
  reprices it, it doesn't beat it. Confidence/pool depth is advisory context.
- **Byte-deterministic** given fixtures + frozen clock (redelivery reproduces the
  on-chain hash).

## Testing (credential-free, fixture-backed)

- `hedge-leg.test.ts` — `priceLeg` golden numbers match S9's known cases
  (ansem NO $5 → 61.25 shares; cap clamp; ladder); `stakeForCoverage` round-trip.
- `hedge-quote.test.ts` — unchanged, proves the refactor is behaviour-preserving.
- `hedge-allocate.test.ts` — explicit sum under budget (no scale); over-budget
  proportional scale; budget mode proportional-to-exposure; cap clamp; single
  leg; zero-exposure residual.
- `portfolio-hedge.test.ts` — a 3-market basket prices all legs; aggregates sum
  correctly; a `budgetUsd` under the requested total scales every leg; one
  `no_market` leg is skipped and flagged while the rest price; two legs on the
  same token surface a `correlatedGroups` entry; a bad quote → one `error` leg,
  others OK; all-unmatched → `no_market`; malformed/mixed-mode input throws
  before any money math; byte-determinism.

`pnpm gate` stays green.

## File manifest

New:
- `packages/oracle/src/core/hedge/{leg,allocate}.ts`
- `packages/oracle/src/core/services/portfolio-hedge.ts`
- `packages/oracle/src/worker/smoke-portfolio-hedge.ts`
- `packages/oracle/test/{hedge-leg,hedge-allocate,portfolio-hedge}.test.ts`
- `docs/PORTFOLIO-HEDGE.md`

Modified:
- `packages/oracle/src/core/services/hedge-quote.ts` (consume `priceLeg`)
- `packages/oracle/src/core/pricing.ts` (`portfolio-hedge` row)
- `packages/oracle/src/config.ts` (`PORTFOLIO_HEDGE_MAX_STAKE_USD`, `_MAX_LEG_STAKE_USD`)
- `packages/oracle/src/worker/main.ts` (register `portfolio-hedge`)
- `packages/oracle/package.json` (`smoke:portfolio-hedge`), `.env.example`,
  `README.md`, `apps/web/src/app/docs/page.tsx`
