# Deploy — get the desk ONLINE and driving activity

The CROO agent dashboard shows your agents **OFFLINE** with ~$0 activity for one
reason: **the worker isn't hosted anywhere.** The desk is a long-lived process
that holds a WebSocket to CROO ([`worker/main.ts`](../packages/oracle/src/worker/main.ts));
while it runs, the seller agent shows **ONLINE** and answers orders. Nothing is
running it 24/7, so both agents are dark. This is an ops gap, not a code gap —
the desk itself (S0–S14) is complete and green.

This runbook hosts two processes with Docker so the dashboard fills up honestly:

| Process | Compose service | Makes the dashboard show |
|---|---|---|
| Provider desk | `worker` | The seller agent **ONLINE**, answering 8+ services, booking earnings |
| Signal-buyer | `buyer` | The **"hunch buyer"** agent with recurring, **capped** orders/volume |

Portable image — runs anywhere Docker does (a VPS, Railway, Render, Fly). No
build step: it runs the TypeScript on `tsx`, the same way the desk runs in dev.

---

## 0. Two things only you can do

I can't do these from a coding session — they need your CROO login:

1. **Register the agents & capture keys** at [agent.croo.network](https://agent.croo.network).
   You already have the **Hunch** seller agent and the **hunch buyer** agent
   (both in your dashboard). The buyer needs a **distinct** key from the seller —
   *an agent cannot hire itself.*
2. **Create the services** under the seller agent and copy each `serviceId`.
   The exact listing copy (name, price, SLA, description) is ready to paste in
   [LISTINGS.md](LISTINGS.md).

Everything else below is turnkey.

---

## 1. Fill in `.env`

```bash
cp .env.example .env
```

Set these (see `.env.example` for the full annotated list):

| Var | What |
|---|---|
| `CROO_SDK_KEY` | The **seller** agent's key (Hunch). Powers the `worker`. |
| `CROO_REQUESTER_SDK_KEY` | The **buyer** agent's key. Distinct from the seller. |
| `ORACLE_SERVICE_MAP` | JSON `{ "<serviceId>": "<handler>" }` — map each service you created to its handler. Full template below. |
| `SIGNAL_BUYER_*` | Buyer allowlist + caps. Leave `SIGNAL_BUYER_ENABLED=false` for the first boot (dry-run). |

`worker` needs no ledger/health config — compose sets `ORACLE_HEALTH_PORT=8080`
and `ORACLE_LEDGER_PATH=/app/data/track-record.jsonl` (a named volume) for you.

### The full service catalogue

The desk ships **8 priced services + a track-record scorecard** — map all of
them for full coverage of the CROO dashboard:

| Handler | Listing | Price | SLA |
|---|---|---|---|
| `forecast` | Hunch Oracle | $0.25 | 5 min |
| `sentiment` | Hunch Oracle | $0.10 | 5 min |
| `research` | Hunch Oracle | $0.50 | 10 min |
| `verify` | Hunch TruthCheck | $0.50 | 10 min |
| `watch` | Hunch TruthCheck | $0.50 | up to 120 min |
| `spawn` | Hunch Market Desk | $2.50 | 10 min |
| `hedge-quote` | Hunch Market Desk | $1.00 | 10 min |
| `portfolio-hedge` | Hunch Market Desk | $3.00 | 10 min |
| `scorecard` | (any) — track record | free | — |

`scorecard` is only served when a ledger is enabled; compose enables it, so
include it. Template (swap each `svc_*` for the real id, drop rows you skip):

```json
{"svc_forecast":"forecast","svc_sentiment":"sentiment","svc_research":"research","svc_verify":"verify","svc_watch":"watch","svc_spawn":"spawn","svc_hedge_quote":"hedge-quote","svc_portfolio_hedge":"portfolio-hedge","svc_scorecard":"scorecard"}
```

> One worker/key can host many services, so a single seller agent can carry the
> whole catalogue. If you'd rather split them across the three listings (Oracle
> / TruthCheck / Market Desk) as separate CROO agents, run one `worker` replica
> per agent — each with its own `CROO_SDK_KEY` and its own `ORACLE_SERVICE_MAP`
> subset. See "Multiple seller agents" below.

---

## 2. Bring it up

```bash
docker compose up -d --build
```

This builds one image and starts `worker` + `buyer`.

**Verify the desk is ONLINE:**

```bash
curl -s localhost:8080/healthz    # {"connected":true,...} with HTTP 200
```

- `200` / `connected:true` → the WS is up. The **Hunch** agent flips **ONLINE**
  on agent.croo.network within a few seconds.
- `503` → the WS is down (bad key / wrong `CROO_WS_URL` / network). Check
  `docker compose logs worker`. The compose healthcheck restarts a desk that
  drops offline.

Send one paid order from another agent (or your buyer allowlist) and watch
**Orders / Volume / Earnings** move on the dashboard.

---

## 3. Turn on real (capped) activity

The `buyer` boots in **dry-run**: it loops every `SIGNAL_BUYER_ROUND_INTERVAL_MS`
(default 15 min) and logs what it *would* hire, moving no money. To go live:

1. Fill `SIGNAL_BUYER_ALLOWLIST` with human-vetted counterparties — a JSON array
   of `{ "serviceId": "svc_...", "label": "...", "category": "research", "maxPriceUsd": 1 }`.
2. Confirm the caps: `SIGNAL_BUYER_DAILY_CAP_USD` (default $5/UTC-day) and
   `SIGNAL_BUYER_MAX_PRICE_USD` (default $1/order).
3. Set `SIGNAL_BUYER_ENABLED=true`.
4. `docker compose up -d buyer` to restart just the buyer.

Every purchase passes a deterministic gate against the **real** negotiated price
and the daily cap ([`policy.ts`](../packages/oracle/src/core/signal-buyer/policy.ts));
an LLM is never in the money decision. The cap holds across rounds because the
buyer runs as **one long-lived process** — the daily-spend ledger is in memory,
so a fresh process per round would reset it. That's exactly why there's a
`signal-buyer-loop`, not a cron of the one-shot ([`loop.ts`](../packages/oracle/src/core/signal-buyer/loop.ts)).
It holds no escrow between rounds, so a restart is always safe.

---

## 4. Ops

On the worker's `8080` (all fail-soft — a ledger hiccup never 500s liveness):

| Path | What |
|---|---|
| `/healthz`, `/status` | JSON liveness — `connected`, uptime, counters. `503` when the WS is down. |
| `/metrics` | Prometheus exposition — throughput, booked revenue, live calibration. Point Grafana here. |

```bash
docker compose logs -f worker      # desk
docker compose logs -f buyer       # what the buyer hired / skipped and why
docker compose ps                  # health status
```

The track-record ledger persists in the `oracle-data` named volume, so the
scorecard survives restarts and redeploys.

---

## Multiple seller agents (optional)

To run the three listings as separate CROO agents (e.g. to use the 3-agent
onboarding reward), add one service per extra agent to `docker-compose.yml`,
each pointing at its own key + map:

```yaml
  worker-truthcheck:
    <<: *oracle
    environment:
      CROO_SDK_KEY: ${CROO_TRUTHCHECK_SDK_KEY}
      ORACLE_SERVICE_MAP: '{"svc_verify":"verify","svc_watch":"watch"}'
      ORACLE_HEALTH_PORT: "8081"
    ports: ["8081:8081"]
```

Each is an independent ONLINE agent. The default single-worker setup already
carries the whole catalogue, so this is only for the multi-agent layout.

---

## Notes

- **No build step / image size.** The image runs `tsx` (a devDependency), so the
  install keeps dev deps — simplest and zero source-vs-compiled drift. If you
  want a smaller prod image later, add a `tsc` build and run `node dist/...`;
  the code already compiles under the workspace `tsconfig`.
- **Secrets.** `.dockerignore` keeps `.env` out of the image; keys arrive at
  runtime via `env_file`. Logs are redaction-wrapped so a `croo_sk_` key never
  prints ([`runtime.ts`](../packages/oracle/src/ports/runtime.ts)).
- **Non-root.** The container runs as the unprivileged `node` user.
