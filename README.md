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
| `portfolio-hedge` | **Non-custodial** basket hedge for a whole book: one budget allocated across many positions, priced off the live markets, with portfolio aggregates + a correlation flag |
| `scorecard` | The desk's **public, tamper-evident track record**: every forecast it sold, scored against real resolution — Brier, calibration, head hash to pin |

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

## The desk you can audit

An LLM can *claim* calibration. This desk lets you check it. Every `forecast` it
sells is recorded to an **append-only, hash-chained ledger** the instant its CAP
delivery confirms, then scored against the market's **real resolution** — the
same production resolver `verify` reads. The `scorecard` service publishes the
aggregate: Brier score, log-loss, a calibration table (predicted vs observed per
bucket), and the **ledger head hash** you can pin to prove the record wasn't
edited later. Only *resolved* markets count toward the score — pending ones are
listed but never inflate the numbers. Recording is **advisory**: a ledger
failure can never fail a paid delivery, so the money path stays clean; and the
whole thing is **opt-in** (`ORACLE_LEDGER_PATH`), strictly additive to the
existing desk. See [docs/SCORECARD.md](docs/SCORECARD.md); watch the full
flywheel run credential-free with `pnpm --filter @hunch/oracle smoke:scorecard`,
and browse the public page at `/scorecard`.

## Hedge a book, not just a bet

`hedge-quote` prices one hedge; **`portfolio-hedge`** prices a coordinated basket
across a whole book in one order. Hand it a set of positions and one budget, and
a deterministic allocator splits that budget across the legs — proportional to
exposure, or scaled down proportionally when the requested premiums exceed the
cap — prices each leg off its live market (through the *same* `priceLeg` module
`hedge-quote` uses, so the numbers agree), and returns portfolio aggregates plus
a ready-to-sign trade call per leg. It stays honest about risk: exposure,
premium, payout, coverage ratio, and a **same-instrument correlation flag** (legs
on the same market/token are grouped as "not independent") — but **no fabricated
covariance or VaR**, because we don't have a returns series to invent one from.
Non-custodial throughout, per-leg fail-soft (one bad market degrades that leg,
not the basket), and byte-deterministic. See
[docs/PORTFOLIO-HEDGE.md](docs/PORTFOLIO-HEDGE.md); demo it credential-free with
`pnpm --filter @hunch/oracle smoke:portfolio-hedge`.

## Watch it — Prometheus, revenue, live calibration

The desk counts everything it does and knows what every service is worth, so S12
exposes a standard Prometheus **`/metrics`** endpoint on the same ops port as the
status page (`ORACLE_HEALTH_PORT`) — no new config. Throughput, uptime, per-service
delivery counts, **booked revenue at list price**, and the live scorecard family
(Brier, hit-rate) all become time series you can point Grafana at. Booked revenue
(delivered × list price, computed in-process) is kept deliberately distinct from
the **settled** USDC the dashboard reads off Base — two honest numbers, never
conflated. No latency histogram is faked: CAP gives us no reliable per-order start
time, so we omit it rather than invent a distribution. It's dependency-free (we
own the exposition format, no `prom-client`) and golden-tested for byte-stability.
See [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md); watch it credential-free with
`pnpm --filter @hunch/oracle smoke:metrics`, and browse the catalog at `/metrics`.

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

Watch it survive a bad day (credential-free): `pnpm --filter @hunch/oracle
smoke:hardening` runs the desk through `kill -9` mid-order, transient deliver
failures, reconnect storms, and SLA expiry — asserting no double delivery and no
stuck escrow — then curls the `/status` page.

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

## Hardened for a bad day

The provider loop is built to survive real infrastructure: WS reconnect storms,
duplicate events, transient deliver failures, SLA expiry mid-work, reject-at-paid
refunds, and `kill -9` mid-order. The rule that makes recovery trivial is that
**the CAP order status — never in-memory state — is the source of truth**, so a
crashed worker recovers cleanly on restart via a startup sweep: delivered exactly
once, no double delivery, no stuck escrow. Transient blips get bounded retry with
backoff; anything still failing is deferred to a periodic sweep. Secrets are
redacted at every log boundary, and `ORACLE_HEALTH_PORT` exposes a `/status`
liveness page. It's all proven by a credential-free chaos + fuzz suite — see
[docs/HARDENING.md](docs/HARDENING.md).

## License

MIT
