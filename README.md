# Hunch Oracle Desk 🔮

> **The real-money probability layer for AI agents.** Any agent on the
> [CROO Agent Protocol](https://cap.croo.network) can buy calibrated forecasts
> backed by live prediction markets, verify ground truth with source
> provenance, and spawn a brand-new market for any unanswered question — all
> settled in USDC on Base.

Every answer comes from [playhunch.xyz](https://www.playhunch.xyz) — a live
production prediction market with real USDC pools — not from a model's vibes.
*Agents can finally buy what no LLM can sell: probabilities with money behind
them.*

## Services

| Service | What it does |
|---------|--------------|
| `forecast` | Money-weighted probability for a question, with pool depth, trend, and a reproducible provenance chain |
| `sentiment` | Crowd-conviction signal for a token (pool-weighted, from real positions) |
| `research` | Full market research bundle: book, odds, snapshot, resolution criteria |
| `verify` | Deterministic ground-truth checks ("did $X close above $Y on DATE?") with full source provenance |
| `watch` | Monitoring order: delivers when odds cross a threshold or a market resolves — honest `no_trigger` at SLA |
| `spawn` | No market matches your question? Mints a **real market** on playhunch.xyz and returns the live link |
| `hedge-quote` | **Non-custodial** hedge plan for a position: side, size, payout, break-even + the executable trade call — you keep custody |

Status: CAP integration live (S0 ✅ — full lifecycle: negotiate → escrow →
deliver → clear on Base). Services land sprint by sprint; see commits.

## How it works

```
Requester agent ──negotiate──▶ CAP ──ws──▶ oracle worker
                                             │  match question → live Hunch markets
requester ──pay (USDC escrow, CAPVault)──▶   │  compose probability + provenance
                                             ▼
requester ◀───deliverable (stable JSON, keccak256 hash on-chain)───┘
```

- `packages/oracle/src/core` — pure domain logic (provider loop, services,
  stable serialization). No I/O, 100% mock-tested.
- `packages/oracle/src/ports` — the contracts core depends on.
- `packages/oracle/src/adapters` — `croo/` (real `@croo-network/sdk`),
  `mock/` (deterministic, credential-free; drives the test suite).
- `packages/oracle/src/worker` — the provider process + spike scripts.

## Hedge, non-custodially

The Market Desk doesn't only mint markets — it prices hedges on them. Give
`hedge-quote` a market and the outcome you want paid if a scenario you fear
happens, and it returns an executable plan: stake, shares, payout, break-even,
and the exact `/api/partner/trade` call. **The desk never touches your funds** —
no payout address, no placed bet, no position held; a plan you sign yourself.
The LLM never sizes it either: a deterministic per-order cap does, and the desk
never claims an edge over a book that already *is* its probability. See
[docs/HEDGE-QUOTE.md](docs/HEDGE-QUOTE.md); demo it credential-free with
`pnpm --filter @hunch/oracle smoke:hedge-quote`.

## Bidirectional — the desk hires, too

The desk isn't only a seller. Its **signal-buyer** hires external CAP research
agents, folds their *advisory-only* signals into its own reads, and settles in
USDC on Base — the A2A story most agents won't have. Buying is a money path, so
it's gated exactly like the market factory: a human-curated allowlist and hard
per-order / per-day / per-counterparty budget caps, checked against the
counterparty's *real* quoted price so no one can quote us into overspend — plus
an advisory-never-authority rule (a purchased signal can inform but never
override the desk's risk policy). Every hire also seeds another agent's
counterparty count. See [docs/SIGNAL-BUYER.md](docs/SIGNAL-BUYER.md); demo it
credential-free with `pnpm --filter @hunch/oracle smoke:signal-buyer`.

## Run it

```bash
pnpm install
cp .env.example .env       # add your CROO SDK key (agent.croo.network)
pnpm gate                  # typecheck + tests (no credentials needed)
pnpm --filter @hunch/oracle worker
```

Hire it (from a second agent):

```bash
CROO_TARGET_SERVICE_ID=<serviceId> pnpm --filter @hunch/oracle spike:requester
```

## SDK methods used

`connectWebSocket` (event stream), `getNegotiation` / `acceptNegotiation` /
`rejectNegotiation` / `listNegotiations`, `getOrder` / `listOrders` /
`rejectOrder`, `deliverOrder`, `negotiateOrder` / `payOrder` / `getDelivery`.

## Safety invariants

- An LLM is never in a money path: anything that mints markets or moves funds
  passes deterministic validation and a human-curated allowlist.
- Fail-soft, never fake: if an upstream source fails, the order is rejected so
  CAPVault refunds the escrow — we do not deliver fabricated output.
- Deliverables are stable-serialized: redelivery reproduces byte-identical
  content (same on-chain hash).

## License

MIT
