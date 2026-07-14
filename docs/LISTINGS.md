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

## Step 2 of the New Service dialog — "Details"

**Deliverable: `Text`. Requirements: `Text`. For every service, no exceptions.**

Not a style choice — the worker's only delivery path hardcodes `type: "text"`
([`provider-loop.ts`](../packages/oracle/src/core/provider-loop.ts)), so picking
`Schema` would advertise a shape the desk never sends. The payload *is* JSON; it
just travels as a text blob. Inbound, the worker runs `JSON.parse(requirements)`
and hands the handler `input` (or `null` when it isn't valid JSON).

Paste these into the two boxes:

### `forecast`
- **Deliverable (Text):** JSON: `probability` (0–1), live `odds`, pool depth, `confidence` (down to `prior_only` when the book is unbet), the market link, and a full source-provenance chain. If no market matches: `no_market` + a `spawnHint` you can feed to the spawn service.
- **Requirements (Text):** JSON: `{"question": "Will $AIXBT reach $50M market cap by July 15?"}`. Optional: `token`, `horizonDays`.

### `sentiment`
- **Deliverable (Text):** JSON: bullish/bearish/neutral `lean`, `conviction` score, pool-weighted signal per market, and provenance.
- **Requirements (Text):** JSON: `{"token": "ANSEM"}`.

### `research`
- **Deliverable (Text):** JSON: live odds, pool stats, the token reading backing resolution (with source link), resolution criteria in plain language, related live markets, trending rank.
- **Requirements (Text):** JSON: `{"marketSlug": "ansem-flip-pump"}` or `{"question": "..."}`.

### `verify`
- **Deliverable (Text):** JSON: `yes` / `no` / `indeterminate` verdict + the underlying reading + source URL + read timestamp. Never a fabricated verdict — a source failure returns `indeterminate` with the error chain.
- **Requirements (Text):** JSON claim template: `{"family": "mcap_close", "token": "AIXBT", "line": 50000000, "date": "2026-07-01"}`.

### `watch`
- **Deliverable (Text):** JSON: the trigger event the moment it fires (odds crossing your threshold, or the market resolving), with the reading and timestamp. Honest `no_trigger` delivery if nothing fires inside the SLA.
- **Requirements (Text):** JSON: `{"marketSlug": "...", "trigger": {"kind": "oddsCross", "threshold": 0.7}}` or `{"marketSlug": "...", "trigger": {"kind": "resolution"}}`.

### `spawn`
- **Deliverable (Text):** JSON: the live market link on playhunch.xyz, its slug, and seeded odds — a real, tradeable market humans can price.
- **Requirements (Text):** JSON: `{"token": "AIXBT", "targetUsd": 100000000, "horizonDays": 30}`. Token must be on the pinned allowlist.

### `hedge-quote`
- **Deliverable (Text):** JSON: which Hunch market, which side, what size, expected payout at current odds, and executable trade instructions against the live book. Non-custodial — you keep custody.
- **Requirements (Text):** JSON: `{"marketSlug": "...", "side": "yes", "stakeUsd": 5}`.

### `portfolio-hedge`
- **Deliverable (Text):** JSON: a priced hedge leg per position (market, side, stake, expected payout, executable trade call), plus portfolio aggregates and an honest same-instrument correlation flag. One bad market fails soft to a single `error` leg; the rest still price.
- **Requirements (Text):** JSON: `{"legs": [{"marketSlug": "...", "side": "yes", "exposureUsd": 40}], "budgetUsd": 20}` — or per-leg `stakeUsd`/`coverageUsd` instead of `budgetUsd`.

### `scorecard`
- **Deliverable (Text):** JSON: the desk's own calibration — Brier score, hit-rate and calibration buckets across every delivered `forecast` that has since resolved, read from an append-only, hash-chained ledger.
- **Requirements (Text):** JSON: `{}` for the full rollup.

---

## After creating each service

1. Copy the service id from the dashboard.
2. Add it to `ORACLE_SERVICE_MAP` (JSON: id → handler name above).
3. Restart the worker. It accepts only mapped services and rejects everything
   else, so a typo'd id fails loud, not silent.
