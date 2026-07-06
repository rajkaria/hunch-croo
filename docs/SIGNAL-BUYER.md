# Signal-buyer — the desk hires, too (S8)

Most agents on the CROO Agent Protocol only sell. The Hunch Oracle Desk also
**buys**: it hires external CAP research agents, folds their signals into its own
reads, and settles in USDC on Base like everything else. That makes it a
bidirectional participant — and every hire seeds another agent's counterparty
count on the way.

The catch: buying is a **money path**. So the signal-buyer obeys the same
invariants as the market factory — an LLM is never in the loop, a human curates
the allowlist, and hard budget caps bound every dollar.

## The lifecycle

```
allowlist entry ──negotiate──▶ counterparty accepts ──▶ order_created
                                                          │ read REAL price
                                          ┌───────────────┤ gate(order)
                             over budget  │               │  within budget
                                          ▼               ▼
                                    reject (no escrow)   pay (USDC escrow, Base)
                                                          │
                                          order_completed ▼
                                          getDelivery → normalize → ExternalSignal
```

The pay decision runs at `order_created`, against the counterparty's **actual
quoted price** — never an estimate. A counterparty cannot quote us into
overspend: if the real price breaks a cap, we reject the created order and
**zero dollars move**.

## The three caps (all human-set, none negotiable by a counterparty)

| Cap | Env | Meaning |
|-----|-----|---------|
| Per-order | `SIGNAL_BUYER_MAX_PRICE_USD` | No single hire above this, ever. |
| Per-day | `SIGNAL_BUYER_DAILY_CAP_USD` | Total USDC out per UTC day, across all counterparties. |
| Per-counterparty/day | `SIGNAL_BUYER_PER_SERVICE_CAP_USD` | Optional ceiling on any one agent per day. |

Allowlist entries may also declare a tighter per-entry `maxPriceUsd`; the
effective ceiling is always the *minimum* of the entry cap and the global cap.
The round is sequential, so each pay-gate sees the fully-settled spend of the
hires before it — the daily cap can never be raced.

## Advisory, never authority

A purchased signal is typed `authority: "advisory"`. That is not decoration —
`decide()` (in [`signal.ts`](../packages/oracle/src/core/signal-buyer/signal.ts))
guarantees:

1. **Bounded nudge** — advisories move our probability at most
   `±maxAdvisoryNudge` from our own pool-implied read.
2. **No manufactured size** — authorized position size never exceeds what our
   *own* conviction warrants (advisories can only shrink it on disagreement),
   and never exceeds `maxSizeUsd`.
3. **Risk gate** — below a minimum *own* confidence, **no** advisory can make us
   act. Purchased conviction is not our conviction.

A bought signal informs the desk. It never overrides the desk's risk policy.

## Run it

```bash
# Credential-free end-to-end demo (mock counterparties, no keys, no network):
pnpm --filter @hunch/oracle smoke:signal-buyer

# Dry run against the live allowlist (decides, logs, moves NOTHING):
pnpm --filter @hunch/oracle signal-buyer

# Live, capped hiring (requires a distinct requester key + a non-empty allowlist):
SIGNAL_BUYER_ENABLED=true pnpm --filter @hunch/oracle signal-buyer
```

The dashboard's **"Who we hired"** section reads the same truth on-chain:
`role=requester` completed orders from CROO's order API, with the Base
settlement hash for every hire.

## Fail-soft

A silent or failing counterparty resolves to a terminal `failed`/`rejected`
outcome — never a throw, never a fabricated signal. Escrow refunds on
non-delivery via the CAP SLA. We record the honest outcome in the ledger either
way; only *delivered* purchases count as spend.
