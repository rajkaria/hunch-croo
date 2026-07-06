# hedge-quote — the desk prices a hedge, you keep custody (S9)

The Hunch Market Desk can `spawn` a real market for your question. `hedge-quote`
is the other half of the desk: given a market and the outcome you want to be
paid on if a feared scenario happens, it prices an **executable, non-custodial
hedge plan** — stake, shares, payout, break-even, and the exact
`/api/partner/trade` call to place it yourself.

**Non-custodial is the whole point.** The desk never touches your funds. It does
the desk work — sizing, pricing, the reality-check — and hands back a plan *you*
sign. There is no `payoutAddress`, no `betReceipt`, no `positionId`: a plan,
never a placed bet. That keeps a genuinely useful hedge service entirely outside
the money path, which is exactly why it can ship inside the hackathon window.

## The shape

```
{ marketSlug | question,          // which live Hunch market prices the risk
  side("yes"|"no") | outcome(key), // the outcome that pays in the feared scenario
  stakeUsd | coverageUsd }         // premium to spend, OR desired payout to back-solve
```

- **Market** resolves by slug (pass-through) or by deterministic free-text match
  — the same matcher `forecast`/`research` use, `/discover` riding along so a
  freshly `spawn`ed market is immediately hedgeable. No match → `no_market` + a
  `spawnHint`, identical to `forecast`.
- **Side vs outcome** is validated against the live book shape: a yes/no market
  demands a `side`; a ladder/multi-outcome market demands an `outcome` key. A
  mismatch is rejected before any money math runs.
- **Sizing** takes either a `stakeUsd` (premium) or a `coverageUsd` (the payout
  you want the hedge to deliver, from which the desk back-solves the stake).

## The economics (deterministic, reproduced from the live price)

Every number is computed from the marginal price of the chosen outcome and the
market fee — verified against recorded playhunch.xyz quotes, so the same book
state yields byte-identical output:

```
price    = priceCents / 100
feeUsd   = stake · feeBps / 10_000
netUsd   = stake − feeUsd
shares   = netUsd / price
payout   = shares · $1      (each winning share settles at $1)
breakeven= price            returnMultiple = payout / stake
```

`coverageUsd` inverts it: `stake = coverageUsd · price / (1 − feeRate)`, then the
plan is recomputed forward from the (capped, rounded) stake so what's reported is
exactly what executes.

## Money-path safety

1. **The LLM never sizes a hedge — a deterministic cap does.**
   `HEDGE_QUOTE_MAX_STAKE_USD` (default `$10`) clamps the recommended stake.
   An over-cap ask is clamped and flagged `capApplied: true`, never silently
   honoured. (Non-custodial, so this bounds the *plan*, not the desk's wallet.)
2. **No fabricated edge.** On a Hunch market the pool-implied price *is* the
   desk's probability, so the desk never claims to beat the book — that would be
   circular. Pool depth, `confidence` (down to `prior_only` on an unbet book),
   and the token reality-reading are surfaced as **advisory context**, explicitly
   never a directive to trade.
3. **Fail-soft, never fake.** An unknown market, a dead outcome, or a shape
   mismatch throws → the provider loop rejects the order and CAPVault refunds the
   escrow. The desk never delivers a fabricated plan inside SLA.
4. **Deterministic deliverable.** Stable key order, no timestamps outside `asOf`
   — redelivery of the same order reproduces the identical plan (same on-chain
   keccak hash).

## What you get back

`{ status, custody:"none", market, hedge{side|outcome, priceCents,
impliedProbability}, plan{stakeUsd, feeUsd, netUsd, shares, payoutIfWinUsd,
profitIfWinUsd, returnMultiple, breakevenProbability, maxStakeUsd, capApplied,
belowMinTicket}, coverage{requested/provided/premium/fullyCovered}?, context{
confidence, poolUsd, totalBets, tokenSnapshot, note}, execute{ custody:"none",
endpoint, method:"POST", params, appUrl }, disclaimer, provenance[], asOf }`

## Run it

```bash
# Credential-free demo — four hedge shapes, no keys, no network:
pnpm --filter @hunch/oracle smoke:hedge-quote
```

Output shows a cheap-side insurance buy, coverage sizing, the cap clamping an
oversized ask, and a ladder-band hedge — every plan non-custodial. Once the
`hedge-quote` service is listed and mapped in `ORACLE_SERVICE_MAP`, the worker
answers paid orders against the live playhunch.xyz book.
