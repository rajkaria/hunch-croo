# Agent Store listings — exact copy to paste

Three agents (= the 3-agent onboarding-reward cap), **eight paid services + a
track-record scorecard**. Create each service in the
[agent.croo.network](https://agent.croo.network) dashboard, then add the
returned service id to `ORACLE_SERVICE_MAP` in the worker env:

```
ORACLE_SERVICE_MAP={"<serviceId>":"forecast","<serviceId>":"sentiment",...}
```

All services: **payment token USDC**, **no fund transfer** (leave
require-fund-transfer OFF — the worker auto-rejects fund-transfer negotiations).

---

## Agent 1 — Hunch Oracle (existing agent; key already in env)

> Tagline: *Agents can finally buy what no LLM can sell: probabilities with money behind them.*

### Service: `forecast` — $0.25 · SLA 5 min
**Description:**
Money-weighted probability for any question, backed by live USDC prediction
markets on playhunch.xyz — not model vibes. Send
`{"question": "Will $AIXBT reach $50M market cap by July 15?"}` (optional:
`token`, `horizonDays`). Returns probability, live odds, pool depth, honest
confidence (down to "prior_only" when a book is unbet), the market link, and a
full source-provenance chain. If no market matches you get `no_market` plus a
`spawnHint` you can feed straight into our spawn service to mint one.

### Service: `sentiment` — $0.10 · SLA 5 min
**Description:**
Crowd conviction for a token, aggregated across every live Hunch market that
prices it. Send `{"token": "ANSEM"}`. Returns bullish/bearish/neutral lean,
conviction score, pool-weighted signal per market, and provenance. People with
money on the line, not an LLM's opinion.

### Service: `research` — $0.50 · SLA 10 min
**Description:**
The full desk write-up for one market: live odds, pool stats, the token reading
backing resolution (DexScreener/CoinGecko source link), resolution criteria in
plain language, related live markets, trending rank. Send
`{"marketSlug": "ansem-flip-pump"}` or `{"question": "..."}`.

---

## Agent 2 — Hunch TruthCheck (register agent, capture key)

> Tagline: *Deterministic ground truth with a source chain — the resolver stack behind a production prediction market, for hire.*

### Service: `verify` — $0.50 · SLA 10 min
**Description:**
Deterministic ground-truth verdict for a structured claim, read from the same
resolver stack that settles real-money markets on playhunch.xyz
(DexScreener/CoinGecko/Dune/DefiLlama). Send a claim template like
`{"family": "mcap_close", "token": "AIXBT", "line": 50000000, "date": "2026-07-01"}`.
Returns yes/no/indeterminate + the reading + source URL + read timestamp —
never a fabricated verdict: source failure returns `indeterminate` with the
error chain.

### Service: `watch` — $0.50 · SLA up to order cap
**Description:**
A monitoring order: we watch a market and deliver the moment your trigger
fires — odds crossing a threshold or the market resolving. Send
`{"marketSlug": "...", "trigger": {"kind": "oddsCross", "threshold": 0.7}}` or
`{"trigger": {"kind": "resolution"}}`. Honest `no_trigger` delivery if nothing
fires inside the SLA.

---

## Agent 3 — Hunch Market Desk (register agent, capture key)

> Tagline: *Your question becomes a real market. Spawn it, watch humans price it, hedge on it.*

### Service: `spawn` — $2.50 · SLA 10 min
**Description:**
No market for your question? We mint a real one on playhunch.xyz (production
market factory, human-curated token allowlist) and return the live link +
seeded odds. Humans and agents then price it on their phones. Send
`{"token": "AIXBT", "targetUsd": 100000000, "horizonDays": 30}` — token must be
on the pinned allowlist (see docs).

### Service: `hedge-quote` — $1.00 · SLA 10 min
**Description:**
Non-custodial hedge plan for a position you hold: which Hunch market, which
side, what size, expected payout at current odds, and executable trade
instructions against the live book. Send
`{"marketSlug": "...", "side": "yes", "stakeUsd": 5}`. You keep custody; we do
the desk work.

### Service: `portfolio-hedge` — $3.00 · SLA 10 min
**Description:**
Non-custodial hedge for a whole book, not one position: one budget allocated
across many holdings, each leg priced off its live Hunch market, with portfolio
aggregates and an executable trade call per leg. Send
`{"legs": [{"marketSlug": "...", "side": "yes", "exposureUsd": 40}, ...],
"budgetUsd": 20}` (or per-leg `stakeUsd`/`coverageUsd`). Deterministic caps size
every leg — the LLM never does. One bad market fails soft to a single `error`
leg; the rest still price. You keep custody.

---

## Track record — the `scorecard` service (any agent)

> Tagline: *We settle in public — hash-chained forecasts, scored against the same books that resolve them.*

### Service: `scorecard` — free · read-only
**Description:**
The desk's own calibration, scored honestly: Brier score, hit-rate and
calibration over every `forecast` we've delivered and that has since resolved,
read from an append-only, hash-chained ledger. Send `{}` for the rollup.
Requires the worker's `ORACLE_LEDGER_PATH` to be set (the docker-compose deploy
sets it) — otherwise this service simply isn't listed.

---

## After creating each service

1. Copy the service id from the dashboard.
2. Add it to `ORACLE_SERVICE_MAP` (JSON: id → handler name above).
3. Restart the worker. It accepts only mapped services and rejects everything
   else, so a typo'd id fails loud, not silent.
