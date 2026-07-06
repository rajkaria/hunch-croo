# Portfolio hedge — hedge a book, not just a bet (S13)

`hedge-quote` (S9) prices one hedge on one market. `portfolio-hedge` prices a
coordinated **basket** across a whole book in one order: give it a set of
positions and a single budget, and it allocates that budget across the legs by a
deterministic rule, prices each off the live market, and hands back
portfolio-level aggregates plus a ready-to-sign trade call per leg — touching
none of your funds.

## Two ways to size it

**Explicit mode** — every position carries its own `stakeUsd` or `coverageUsd`:

```json
{
  "positions": [
    { "marketSlug": "aixbt-50m",       "side": "yes",       "stakeUsd": 5, "exposureUsd": 200 },
    { "marketSlug": "ansem-flip-pump", "side": "no",        "stakeUsd": 5, "exposureUsd": 150 },
    { "marketSlug": "ada-mcap-ladder", "outcome": "le-n20", "coverageUsd": 20 }
  ]
}
```

If the requested premiums sum above the budget cap, every leg is scaled by the
same factor — the *shape* of the book is preserved, the total is honoured.

**Budget mode** — one `budgetUsd`, split proportional to each leg's `exposureUsd`
(equal split when no exposures are given):

```json
{
  "budgetUsd": 30,
  "positions": [
    { "marketSlug": "aixbt-50m",       "side": "yes", "exposureUsd": 300 },
    { "marketSlug": "ansem-flip-pump", "side": "no",  "exposureUsd": 100 }
  ]
}
```

→ $22.50 to the first leg, $7.50 to the second (300:100), each then priced off
its live book. Mixing the two modes is a validation error (rejected before any
money math).

## What comes back

```jsonc
{
  "service": "portfolio-hedge",
  "status": "ok",                 // "no_market" if nothing matched
  "custody": "none",
  "portfolio": {
    "positions": 3, "pricedLegs": 3, "skippedLegs": 0,
    "mode": "explicit",
    "budgetCapUsd": 50, "maxLegStakeUsd": 10,
    "requestedTotalUsd": 15, "totalPremiumUsd": 15,
    "totalPayoutIfAllHitUsd": 101.68,
    "totalExposureUsd": 350, "coverageRatio": 0.29,
    "scaledBy": 1, "capApplied": false
  },
  "correlatedGroups": [
    { "kind": "token", "key": "AIXBT", "legIndexes": [0, 2] }
  ],
  "legs": [
    { "index": 0, "status": "ok", "market": {…}, "hedge": {…},
      "allocation": { "requestedUsd": 5, "allocatedUsd": 5, "source": "explicit" },
      "plan": { "stakeUsd": 5, "shares": 9.8, "payoutIfWinUsd": 9.8, … },
      "execute": { "custody": "none", "endpoint": "…/api/partner/trade", "params": {…} } },
    { "index": 1, "status": "no_market", "spawnHint": {…} }
  ],
  "provenance": [ … ], "asOf": "…"
}
```

## Guarantees (extending hedge-quote to N legs)

- **Non-custodial.** Every leg is a plan with a `/api/partner/trade` call and
  `custody: "none"`. The desk holds no funds, sets no payout address, places no
  order.
- **The LLM never sizes.** A deterministic allocator + total/per-leg caps
  (`PORTFOLIO_HEDGE_MAX_STAKE_USD`, `PORTFOLIO_HEDGE_MAX_LEG_STAKE_USD`) do.
  Over-budget baskets are scaled proportionally, never silently honoured.
- **No fabricated risk math.** Exposure, premium, payout, coverage ratio, and an
  honest same-instrument **correlation flag** (legs on the same market or token
  are grouped and labelled "not independent") — never an invented covariance or
  VaR. We don't have a returns series, so we don't pretend to.
- **Per-leg fail-soft, order-level fail-soft.** One unmatched or dead-outcome
  leg is skipped and flagged while the rest price. A catalogue/validation failure
  — or *every* priceable leg failing upstream — rejects the order so CAPVault
  refunds the escrow. Never a fabricated leg.
- **No claimed edge.** The book price *is* the desk's probability; the basket
  reprices it, it doesn't beat it. Pool depth / confidence is advisory context.
- **Byte-deterministic.** Redelivery reproduces the identical bytes and on-chain
  content hash.

Under the hood, each leg's economics come from the same `priceLeg` module
`hedge-quote` uses, so the two services agree number-for-number.

## See it, credential-free

```bash
pnpm --filter @hunch/oracle smoke:portfolio-hedge
```

Prices a 3-market basket, allocates a budget proportional to exposure, and flags
a same-market correlation — asserting every leg is non-custodial.
