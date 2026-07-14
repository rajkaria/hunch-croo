# Deploy — get the CROO agents ONLINE and selling

Two things were keeping the CROO agent dashboard empty:

1. **Nothing hosted the worker.** The desk is a long-lived process whose live
   WebSocket to CROO *is* the ONLINE signal ([`worker/main.ts`](../packages/oracle/src/worker/main.ts)).
   No host → both agents dark. An ops gap, not a code bug (S0–S14 are green).
2. **Nothing was listed.** `ORACLE_SERVICE_MAP` only ever contained `echo`, the
   S0 test endpoint. All 8 paid services existed in code and none were for sale.

This runbook fixes both.

## The layout

One worker process authenticates as exactly **one** CROO agent (one SDK key) and
answers only that agent's services. So three listings means **three workers,
three keys** — not one worker with a big map.

| Compose service | CROO agent | Services | Port |
|---|---|---|---|
| `worker-oracle` | Hunch Oracle | `forecast`, `sentiment`, `research`, `scorecard` | 8080 |
| `worker-truthcheck` | Hunch TruthCheck | `verify`, `watch` | 8081 |
| `worker-marketdesk` | Hunch Market Desk | `spawn`, `hedge-quote`, `portfolio-hedge` | 8082 |
| `buyer` | hunch buyer | requester side — capped, dry-run by default | — |

> **`scorecard` must sit with `forecast`.** It scores forecasts out of the
> append-only ledger the forecast handler writes, so they must share a worker and
> its volume. Don't split them across agents.

Prices and SLAs live in one place — [`core/pricing.ts`](../packages/oracle/src/core/pricing.ts):

| Handler | Price | SLA |
|---|---|---|
| `forecast` | $0.25 | 5 min |
| `sentiment` | $0.10 | 5 min |
| `research` | $0.50 | 10 min |
| `verify` | $0.50 | 10 min |
| `watch` | $0.50 | up to 120 min |
| `spawn` | $2.50 | 10 min |
| `hedge-quote` | $1.00 | 10 min |
| `portfolio-hedge` | $3.00 | 10 min |
| `scorecard` | free | — |

---

## 1. Create the agents + services (CROO dashboard — only you can)

At [agent.croo.network](https://agent.croo.network):

1. Register **Hunch Oracle**, **Hunch TruthCheck**, **Hunch Market Desk**. Capture
   each agent's SDK key — **shown once**.
2. Under each, create its services. Name, price, SLA and description are ready to
   paste in [LISTINGS.md](LISTINGS.md).
3. Copy the **service id** CROO returns for each one.

All services: **payment token USDC**, **require-fund-transfer OFF** (the worker
auto-rejects fund-transfer negotiations).

The existing **hunch buyer** agent stays as-is — it's the requester. Its key must
stay distinct from the sellers': *an agent cannot hire itself.*

## 2. Fill in `.env`

```bash
cp .env.example .env
```

Three seller keys, three service maps, and the buyer key:

```bash
CROO_ORACLE_SDK_KEY=croo_sk_...
ORACLE_MAP_ORACLE={"<id>":"forecast","<id>":"sentiment","<id>":"research","<id>":"scorecard"}

CROO_TRUTHCHECK_SDK_KEY=croo_sk_...
ORACLE_MAP_TRUTHCHECK={"<id>":"verify","<id>":"watch"}

CROO_MARKETDESK_SDK_KEY=croo_sk_...
ORACLE_MAP_MARKETDESK={"<id>":"spawn","<id>":"hedge-quote","<id>":"portfolio-hedge"}

CROO_REQUESTER_SDK_KEY=croo_sk_...   # the buyer
```

The worker accepts **only** mapped ids and rejects everything else, so a typo
fails loud, not silent.

## 3. Bring it up

```bash
docker compose up -d --build
```

Verify each agent is ONLINE:

```bash
curl -s localhost:8080/healthz   # Hunch Oracle
curl -s localhost:8081/healthz   # Hunch TruthCheck
curl -s localhost:8082/healthz   # Hunch Market Desk
```

- `200` + `"connected": true` → the WebSocket is up; that agent shows **ONLINE**
  on the dashboard within seconds.
- `503` → the WS is down (bad key, wrong `CROO_WS_URL`, network). Check
  `docker compose logs worker-oracle`. The healthcheck restarts an agent that
  drops offline.

Sanity-check a key without booting the worker:

```bash
pnpm --filter @hunch/oracle probe    # read-only: AUTH OK + pending/paid orders
```

## 4. Turn on real (capped) activity

`buyer` boots in **dry-run**: it loops every `SIGNAL_BUYER_ROUND_INTERVAL_MS`
(default 15 min) and logs what it *would* hire, moving no money. To go live:

1. `SIGNAL_BUYER_ALLOWLIST` — a JSON array of human-vetted counterparties:
   `[{"serviceId":"svc_...","label":"Alpha Terminal","category":"research","maxPriceUsd":1}]`
2. Confirm caps: `SIGNAL_BUYER_DAILY_CAP_USD` ($5/UTC-day) and
   `SIGNAL_BUYER_MAX_PRICE_USD` ($1/order).
3. `SIGNAL_BUYER_ENABLED=true`
4. `docker compose up -d buyer`

Every purchase clears a deterministic gate against the **real negotiated price**
and the daily cap ([`policy.ts`](../packages/oracle/src/core/signal-buyer/policy.ts)) —
an LLM is never in the money decision. The cap holds across rounds because the
buyer is **one long-lived process**: its daily-spend ledger is in memory, so a
cron of the one-shot would reset the cap every run and overspend. That's why
there's a `signal-buyer-loop` ([`loop.ts`](../packages/oracle/src/core/signal-buyer/loop.ts)).
It holds no escrow between rounds, so restarting it is always safe.

## 5. Ops

Per worker, on its health port (all fail-soft — a ledger hiccup never 500s liveness):

| Path | What |
|---|---|
| `/healthz`, `/status` | JSON liveness — `connected`, uptime, counters. `503` when the WS is down. |
| `/metrics` | Prometheus — throughput, booked revenue, live calibration. Point Grafana here. |

```bash
docker compose ps                        # health of all four
docker compose logs -f worker-oracle     # a desk
docker compose logs -f buyer             # what the buyer hired / skipped and why
```

The track record persists in the `oracle-data` volume, so the scorecard survives
restarts and redeploys.

---

## Hosting it somewhere that stays on

Any Docker host works — a VPS, Railway, Render, Fly. Point it at this repo; it
picks up the root `Dockerfile`. Set the `.env` values as environment variables in
the host's dashboard.

**Vercel will not work** — it's serverless and cannot hold a long-lived
WebSocket open. The ONLINE signal dies the moment the function returns.

## Notes

- **No build step.** The image runs TypeScript on `tsx` (a devDependency), so the
  install keeps dev deps — simplest, zero source-vs-compiled drift. For a smaller
  prod image later, add a `tsc` build and run `node dist/...`; the code already
  compiles under the workspace `tsconfig`.
- **Secrets.** `.dockerignore` keeps `.env` out of the image; keys arrive at
  runtime via `env_file`. Logs are redaction-wrapped, so a `croo_sk_` key never
  prints ([`runtime.ts`](../packages/oracle/src/ports/runtime.ts)).
- **Non-root.** The container runs as the unprivileged `node` user.
