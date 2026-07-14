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
| `scorecard` | $0.10 | 5 min |

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

### Railway

Railway has no compose file — **one Railway service per process**, so you create
four, all from this same repo and Dockerfile, differing only in env vars:

| Railway service | Config-as-code path | Env vars to set |
|---|---|---|
| `worker-oracle` | `railway.json` | `CROO_SDK_KEY` = the Oracle key, `ORACLE_SERVICE_MAP` = the Oracle map, `ORACLE_LEDGER_PATH=/app/data/track-record.jsonl` |
| `worker-truthcheck` | `railway.json` | `CROO_SDK_KEY` / `ORACLE_SERVICE_MAP` for TruthCheck |
| `worker-marketdesk` | `railway.json` | `CROO_SDK_KEY` / `ORACLE_SERVICE_MAP` for Market Desk |
| `buyer` | `railway.buyer.json` | `CROO_SDK_KEY` = **any** seller key (unused by the loop; the schema requires one), `CROO_REQUESTER_SDK_KEY` = the buyer key, plus the `SIGNAL_BUYER_*` caps |

Per service, in **Settings**:

- **Root Directory** `/` — the `Dockerfile` lives at the repo root; a subdirectory
  root makes Railway miss it and fall back to a Node buildpack.
- **Config-as-code** → the path above. [`railway.json`](../railway.json) pins the
  Dockerfile builder, the start command, and a `/healthz` healthcheck;
  [`railway.buyer.json`](../railway.buyer.json) swaps in the buyer loop and drops
  the healthcheck (the buyer is a loop, not a server — it has no port to check).
- **Leave the Start Command box empty.** Config-as-code and the image `CMD`
  already set it, and a hand-typed one silently overrides both. See the
  troubleshooting entry below — that is exactly how this breaks.
- `worker-oracle` only: add a **Volume** mounted at `/app/data`. That's the
  hash-chained forecast ledger `scorecard` reads; without it, redeploying wipes
  the track record. The other three are stateless.

Railway injects `PORT` and healthchecks it. The worker binds it automatically
(`healthPortFromEnv` in [`config.ts`](../packages/oracle/src/config.ts)), so
`/healthz`, `/status` and `/metrics` come up on Railway's port with no extra
config. Don't set `ORACLE_HEALTH_PORT` on Railway — it would win over `PORT` and
the platform healthcheck would hit a closed port and kill the deploy.

`/healthz` returns `200` only while the CROO WebSocket is connected, so a Railway
deploy that goes green *is* the agent showing ONLINE.

## Troubleshooting

### `sh: 1: next: not found` / `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL … @hunch/oracle-web start: next start`

The host is not running the image's `CMD`. It ran a **recursive** start
(`pnpm -r start`), which fans out across every workspace package and walks into
`apps/web` — the Next.js surface, which is deployed separately and whose deps the
image deliberately does not install (`--filter @hunch/oracle...`), hence
`next: not found`. The worker never boots and the agent stays OFFLINE.

Almost always a **Start Command typed into the host's dashboard**, overriding both
the config file and the image `CMD`. Clear it, and let one of these run instead:

| Command | Result |
|---|---|
| *(empty — the image `CMD`)* | `pnpm --filter @hunch/oracle worker` ✅ |
| `pnpm start` | root script → the worker ✅ |
| `pnpm -r start` | only `@hunch/oracle` has a `start` script → the worker ✅ |

All three now land on the worker: the root `package.json` has a `start` script,
`@hunch/oracle` has one too, and the image prunes `apps/` and `examples/` after
install — so no recursive script run can reach `next` even if a host injects one.

## Notes

- **No build step.** The image runs TypeScript on `tsx` (a devDependency), so the
  install keeps dev deps — simplest, zero source-vs-compiled drift. For a smaller
  prod image later, add a `tsc` build and run `node dist/...`; the code already
  compiles under the workspace `tsconfig`.
- **Secrets.** `.dockerignore` keeps `.env` out of the image; keys arrive at
  runtime via `env_file`. Logs are redaction-wrapped, so a `croo_sk_` key never
  prints ([`runtime.ts`](../packages/oracle/src/ports/runtime.ts)).
- **Non-root.** The container runs as the unprivileged `node` user.
