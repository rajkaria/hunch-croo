---
feature: Hosting — Docker deploy, 3 CROO agents, cap-safe buyer loop (S15)
globs:
  - Dockerfile
  - docker-compose.yml
  - .dockerignore
  - .env.example
  - railway*.json
  - package.json
  - docs/DEPLOY.md
  - docs/LISTINGS.md
  - packages/oracle/src/core/signal-buyer/loop.ts
  - packages/oracle/src/worker/signal-buyer-loop.ts
  - packages/oracle/src/worker/main.ts
  - packages/oracle/src/config.ts
  - packages/oracle/src/core/pricing.ts
  - packages/client/**
updated: 2026-07-15
---

# Hosting — CROO agents ONLINE + first real traction (S15)

Merged to `main` (`a717d1a`). Gate green: typecheck + **269 tests** (260 oracle
+ 9 CAP-client). `@hunchxyz/cap-client@0.1.1` published to npm.

## Current state — what's working, deployed, broken

**🟢 LIVE WITH REAL ORDERS (2026-07-15).** All four processes on Railway (project
**energetic-benevolence** `117ce3e2-ca2e-4b1d-a191-36f3a6d3a442`, acct
rajkaria98@gmail.com, deploys from `main`). All three sellers log `websocket
connected`. **The buyer is LIVE** (`SIGNAL_BUYER_ENABLED=true`) and placing real
orders every round — but they **self-reject on a price bug** (next-step #1), so it
isn't spending yet. Two manual hires DID settle end-to-end (forecast + AlphaTrack).

| Railway service | Config | Notes |
|---|---|---|
| `worker-oracle` | root `railway.json` | volume `/app/data` (ledger); real service UUIDs mapped |
| `worker-truthcheck` | root `railway.json` | `trackRecord: disabled` — ledger is Oracle's |
| `worker-marketdesk` | root `railway.json` | hedge caps set; real UUIDs mapped |
| `buyer` | `railway.buyer.json` | **LIVE but self-rejecting** — see next-step #1 (price bug); allowlist = AlphaTrack + Polymind, caps $5/day · $1/order |

**Orders placed (live CROO, real Base USDC):**
- `forecast` self-hire — **completed**, $0.25 (integration test, NOT traction). Full
  lifecycle `created→paying→paid→delivering→evaluating→completed`, real tx hashes.
  Handler searched 198 open Hunch markets, returned `no_market` + near-misses +
  provenance (fail-soft held — never faked a probability).
- AlphaTrack `top_traders` external hire — **completed**, $0.10 (paid by hand via
  raw API). Real Binance top-trader leaderboard, on-chain `deliverTxHash`. Proved
  the fiber-extracted service_id is genuine AND that a full external hire settles.
- **Buyer loop orders all `rejected`** — the loop negotiates and creates orders but
  its own cap gate rejects each with `invalid_price: NaN` (next-step #1). So the
  buyer is armed and placing real orders, but **not yet successfully spending**.
  Cap-safe (no money moves on a reject), but no autonomous traction until fixed.

**The two defects that made traction impossible (both fixed this session).**
Neither showed in the 256-test mock suite; both surfaced on first contact with
the live API. All three CAP-money-path bugs were mock-invisible:

1. **8 of 9 listings rejected every hire.** `ORACLE_SERVICE_MAP` keyed handlers
   by the CROO dialog's *unsaved draft id* (`svc-new-<epoch-ms>`), not the real
   service UUID minted on save. `provider-loop.ts` rejects any negotiation whose
   serviceId doesn't resolve → those 8 rejected everything → read as "no demand".
   Only `portfolio-hedge` had a real UUID. Fixed: real UUIDs mapped on all three
   Railway workers + `.env`; `parseServiceMap` now hard-fails on draft ids.
2. **The published CAP client failed 100% of hires** — two bugs: `role=requester`
   (CAP 400s; must be `buyer`) and no `Content-Type` on bodyless POSTs like
   `payOrder` (CAP 400 `CODEC`). `hire()` hits both on every purchase. Fixed +
   the client got its first tests + republished as 0.1.1.

**Shipped previously (S15).** Root `Dockerfile` (node:22-slim, runs TS on `tsx` — no build step,
non-root `node` user) + `docker-compose.yml` running **four** long-lived processes
from one image:

| Compose service | CROO agent | Services | Port |
|---|---|---|---|
| `worker-oracle` | Hunch Oracle | forecast, sentiment, research, scorecard | 8080 |
| `worker-truthcheck` | Hunch TruthCheck | verify, watch | 8081 |
| `worker-marketdesk` | Hunch Market Desk | spawn, hedge-quote, portfolio-hedge | 8082 |
| `buyer` | hunch buyer | `signal-buyer-loop`, dry-run by default | — |

**Verified against live CROO** (2026-07-14): all four agent keys authenticate
(`pnpm --filter @hunch/oracle probe` → AUTH OK), and all three sellers boot to
`connected: true` on `/healthz` with the right service counts (4 / 2 / 3 = **9
services**). Credentials live in `.env` (gitignored); a backup of the prior
`.env` sits alongside it.

**The first Railway deploy crashed (2026-07-14) — fixed.** The container came up
running a **recursive** start (`pnpm -r start`), not the image `CMD`. Recursion
fans out over every workspace package, walks into `apps/web`, and dies on
`sh: 1: next: not found` + `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` — `apps/web` is a
Next surface whose deps the image deliberately never installs
(`--filter @hunch/oracle...`). Reproduced exactly outside Docker (rsync the repo,
run the Dockerfile's install, `pnpm -r start`), so the diagnosis is not a guess.
Root cause is a host-side Start Command override; the fix makes **every** plausible
start command land on the worker (see Key decisions).

**Then it crashed again on missing keys — and that's the Railway gotcha to remember.**
The compose-only names (`CROO_ORACLE_SDK_KEY`, `CROO_TRUTHCHECK_SDK_KEY`,
`CROO_MARKETDESK_SDK_KEY`) exist **only in `docker-compose.yml`**, which maps them
into the real var (`CROO_SDK_KEY: ${CROO_ORACLE_SDK_KEY}`). Railway has no such
indirection: setting `CROO_ORACLE_SDK_KEY` on a Railway service leaves `CROO_SDK_KEY`
undefined and the worker dies in `readEnv()` (`ZodError … 'Required'`) before opening
the socket. On the two workers whose deploy had a healthcheck this surfaced as
"1/1 replicas never became healthy" — the same crash seen through `/healthz`.
Resolved by pointing the real var at the existing one with Railway's reference syntax,
which also keeps rotation to a one-liner:

    railway variables --set 'CROO_SDK_KEY=${{CROO_ORACLE_SDK_KEY}}' -s worker-oracle

`buyer` gets `CROO_SDK_KEY=${{CROO_REQUESTER_SDK_KEY}}` — the schema demands a
`CROO_SDK_KEY`, but the loop hires with `CROO_REQUESTER_SDK_KEY`, and handing it a
*seller* key would let it try to hire itself.

## Recent changes — files touched and why

### Traction unblock + buyer live (2026-07-15)

- **`packages/client/src/index.ts`** — three live-API fixes: `role=buyer` (was
  `requester`, CAP 400s); `Content-Type: application/json` on **every** POST
  (was gated on a body → bodyless `payOrder` 400'd `CODEC`). Published as
  `@hunchxyz/cap-client@0.1.1` (0.1.0 was 100% broken).
- **`packages/client/test/cap-client.test.ts`** (new, 9 tests) + `vitest.config.ts`,
  `tsconfig` (`include` test), `package.json` (`test` script, vitest dep) — the
  money path had zero tests, which is why the bugs shipped. Pins the wire
  contract: role, Content-Type, `/backend/v1`, `X-SDK-Key`, full hire() lifecycle.
- **`packages/oracle/src/config.ts`** — `parseServiceMap` now **throws** on unsaved
  CROO draft ids (`svc-new-\d+`) with the fix instructions; new `suspectServiceIds`
  flags non-UUID ids. **`worker/main.ts`** warns at boot on any suspect id (a
  never-resolving serviceId is indistinguishable from zero demand otherwise).
- **`packages/oracle/test/config.test.ts`** — +4 tests (draft-id reject, real-UUID
  accept, suspect flagging).
- **`.env` + Railway `ORACLE_SERVICE_MAP` on all 3 workers** — replaced draft ids
  with the real service UUIDs (from Raj's CROO dashboard). **`buyer` service:**
  `SIGNAL_BUYER_ALLOWLIST` = AlphaTrack + Polymind, `SIGNAL_BUYER_ENABLED=true`.

### S15 (original)

- **`Dockerfile`, `.dockerignore`** (new) — one runtime image for every process.
  Installs with `--filter @hunch/oracle...` against the frozen lockfile; keeps
  devDeps because the worker runs on `tsx`. `.dockerignore` keeps `.env` out.
- **`docker-compose.yml`** (new) — the four services above, YAML-anchored. Each
  seller gets its own `CROO_SDK_KEY` + `ORACLE_SERVICE_MAP` + health port. The
  `/healthz` healthcheck returns 503 on a dropped WS, so Docker restarts an agent
  that has gone offline.
- **`core/signal-buyer/loop.ts` + `worker/signal-buyer-loop.ts`** (new) — a
  long-lived buyer daemon, plus `SIGNAL_BUYER_ROUND_INTERVAL_MS` in `config.ts`
  and a `signal-buyer-loop` package script. See Key decisions.
- **`test/signal-buyer-loop.test.ts`** (new, 3 tests) — round accumulation across
  one reused runner, fail-soft on a thrown round, zero rounds when already stopped.
- **`core/pricing.ts` + `apps/web/src/lib/pricing.ts`** — added the `scorecard`
  row at **$0.10** (Hunch Oracle, 5 min).
- **`core/metrics/revenue.ts`** — comments corrected: `echo` is now the *only*
  unpriced service.
- **`test/metrics-revenue.test.ts`** — the "unpriced" case narrows to `echo`; new
  guard that scorecard books 4 × $0.10 = $0.40.
- **`docs/DEPLOY.md`** (new) — the runbook. **`docs/LISTINGS.md`** — was stale
  (missing `portfolio-hedge` S13 and `scorecard` S11); now nine services, plus a
  paste-ready "Details" section for the CROO New Service dialog.
- **`.env.example`** — three seller keys + three service maps.

### Railway crash fix (2026-07-14, post-merge)

- **`Dockerfile`** — `rm -rf apps examples` after the install (a recursive script
  run can no longer reach `next`); `ENV ORACLE_HEALTH_PORT=8080` → `ENV PORT=8080`
  so a PaaS-injected `PORT` wins and its healthcheck reaches the ops server.
- **`package.json` (root)** — added `start` (→ the worker) and `start:buyer`.
- **`packages/oracle/package.json`** — added `start` as an alias of `worker`, so
  even `pnpm -r start` boots the desk.
- **`config.ts`** — `PORT` in the env schema + `healthPortFromEnv(env)`:
  `ORACLE_HEALTH_PORT ?? PORT`. `worker/main.ts` uses it.
- **`railway.json` / `railway.buyer.json`** (new) — config-as-code pinning the
  Dockerfile builder + start command (+ `/healthz` healthcheck on the workers).
  Railway's config-as-code overrides its dashboard, so this can't drift again.
- **`test/config.test.ts`** — 3 tests on the port precedence (PORT fallback,
  explicit `ORACLE_HEALTH_PORT` wins, neither → no ops server).

## Key decisions — choices and trade-offs

- **External service_ids come from React props, not an API.** CROO has **no**
  discovery/search/catalog REST endpoint (docs confirm; `/services` 401s without a
  browser login session; the homepage "MCP `marketplace.search`" is decorative
  marketing pointing at `crew.network`). The `service_id` needed to hire another
  agent is embedded in each service card's React fiber `memoizedProps` on the
  agent's **detail** page (`agent.croo.network/agents/<agentId>`) — public, no
  login. The store *list* card's fiber carries the AGENT id; only the detail-page
  service card carries the SERVICE id. Harvested via the in-app browser.
- **Confirmed external service_ids** (for the buyer allowlist): AlphaTrack
  `top_traders` `f57a40f6-be70-4074-8f09-db46cdf51fed`; Polymind `hot_events`
  `bfddc0e8-fb82-4115-9370-ef235c8996db`; Polymarket Broker `Market Detail`
  `23632a1d-d232-4a4e-b928-da30a73f1dcf`; Polymarket Smart Wallet Tracker
  `022c38ad-0be9-4ee1-8f76-d645cb182010`. Only the first two are in the live
  allowlist — they ignore/allow empty input; the two Polymarket ones need a valid
  market-id / 0x-wallet input or delivery fails (escrow refunds, no loss).
- **Real service UUIDs** (our sellers): forecast `f1c77b72-…`, sentiment
  `d69114e5-…`, research `a722d355-…`, scorecard `51b83b1c-…` (Oracle); verify
  `286798ac-…`, watch `6d044163-…` (TruthCheck); spawn `dafdec76-…`, hedge-quote
  `9c02208a-…`, portfolio-hedge `9eccc75e-…` (MarketDesk).
- **Mocks agreed with the code, not with CROO.** All three money-path bugs passed
  256 mock tests and failed on the first live call. The CAP client now has real
  wire-contract tests; when touching any CAP request, verify against the live API
  (a probe with the real key), not just the mock adapter.
- **The CROO SDK (`@croo-network/sdk@0.2.1`) pay path is SAFE** — its `http-client`
  sends `{}` + Content-Type on bodyless POSTs (`http-client.js:18-34`), so the
  bodyless-POST bug was ours alone. The buyer loop (which pays via the SDK, not our
  client) pays correctly. Verified by source inspection before flipping live.
- **One worker per CROO agent, not one worker for all.** A worker authenticates as
  exactly ONE agent (one SDK key) and only receives negotiations for that agent's
  services. Three listings therefore means three worker processes with three keys
  — not one worker with a big service map. This drove the whole compose shape.
- **The buyer needed a NEW long-lived entrypoint.** The existing `signal-buyer.ts`
  runs one round and exits. Its daily spend cap is computed from an **in-memory**
  ledger (`InMemorySignalStore`), so scheduling the one-shot on a cron would reset
  the cap to zero every run and **blow through the daily budget**. `runBuyerLoop`
  keeps ONE buyer instance alive across rounds so the cap holds; it is fail-soft
  (a thrown round is logged and retried next tick) and holds no escrow between
  rounds, so a hard stop is always safe.
- **`scorecard` is priced at $0.10, not free.** CROO cannot list a $0 service.
  Because booked revenue is computed from `SERVICE_PRICING` *and nothing else*, a
  missing pricing row would have silently reported every scorecard sale as $0.
  It is a credibility surface, not a revenue line — hence the floor price.
- **`scorecard` MUST live on the Oracle agent, beside `forecast`.** It scores
  forecasts out of the append-only ledger the forecast handler writes, so the two
  must share a worker and its volume. Don't split them across agents.
- **CROO dashboard prices must match `core/pricing.ts`.** `/metrics` booked revenue
  comes from the local table, not from what CROO actually charged — a mismatch makes
  the metric silently diverge from settled earnings. `apps/web/src/lib/pricing.ts`
  is a deliberate mirror (the web app stays worker-independent).
- **Deliverable + Requirements are `Text` for every service.** `provider-loop.ts`
  hardcodes `type: "text"` as the only delivery path; advertising `Schema` would
  promise a shape the desk never sends. Payloads are JSON carried as text.
- **`tsx` at runtime, no build step.** Simplest, zero source-vs-compiled drift.
  Trade-off: devDeps stay in the image. A `tsc` build + `node dist/...` would slim
  it later; the code already compiles under the workspace tsconfig.
- **Vercel cannot host this.** Serverless cannot hold the WebSocket open, and that
  WS *is* the ONLINE signal. Railway / Render / Fly / any VPS.
- **Make every start command correct, don't just document the right one.** The
  Railway crash came from a host running its own start command over the image
  `CMD`. Rather than rely on a host never doing that, all four paths now boot the
  worker: image `CMD`, `pnpm start` (root script), `pnpm -r start` (oracle's own
  `start`, and `apps/` is gone from the image so recursion has nowhere else to go),
  and `railway.json`'s pinned `startCommand`. Hosts *will* inject a start command;
  the repo should survive it.
- **The image binds `PORT`, compose pins `ORACLE_HEALTH_PORT`.** A PaaS invents a
  port and healthchecks it; compose needs three fixed, distinct ports on one host.
  `ORACLE_HEALTH_PORT ?? PORT` serves both — and on Railway, setting
  `ORACLE_HEALTH_PORT` would break the platform healthcheck (it'd win over `PORT`,
  and Railway would probe a closed port). Documented in DEPLOY.md.
- **Railway env vars are the RAW names — compose's indirection does not exist there.**
  Set `CROO_SDK_KEY` (via a `${{COMPOSE_NAME}}` reference so one value serves both
  worlds), never assume `CROO_ORACLE_SDK_KEY` alone is enough. This cost a deploy.
- **What the Railway CLI can and cannot do** (4.36): ✅ create services (`railway add
  -s`), set/delete variables, add volumes, read logs/status. ❌ link a GitHub repo
  (`--repo` → `Unauthorized`), set a start command or config-as-code path, delete a
  service — all dashboard-only. Plan any future Railway work around that split.

## Next steps — specific, actionable

Agents ONLINE, listings fixed, buyer LIVE, first real orders placed. What's left:

1. **FIX THE BUYER PRICE BUG — every loop order self-rejects (4th mock-invisible
   bug, diagnosed not fixed).** The loop negotiates and orders get *created*, then
   the buyer's own cap gate rejects them: CROO returns `rejectReason: invalid_price:
   unusable price NaN`. Root cause: the created order carries its value in
   **`order.amount`** (USDC base units — `100000.00000000` = $0.10, ÷ 1e6), but
   `order.price` is **empty** on the live API. `adapters/croo/transport.ts:62` and
   `core/signal-buyer/purchase.ts:99` both read `order.price` → `NaN` →
   `policy.ts:84` (`!Number.isFinite`) → `invalid_price`, no money moves. (The one
   AlphaTrack order that DID complete was paid by hand via the raw API, bypassing
   this gate.) Fix: derive priceUsd from `amount` (÷ 1e6) when `price` is empty; add
   a live-shape test (the mock populates `price`, which is why this shipped). Until
   then the buyer churns negotiate→reject and never spends — cap-safe but useless.
2. **Seed inbound demand from other teams** (the real traction number). Post the
   hire-swap in the hackathon channel: "drop your service_id, I'll route real
   orders to it." Each becomes a genuine external order on our sellers (currently
   1 provider order total — the AlphaTrack test was us hiring *out*).
3. **Add the two Polymarket counterparties** once a valid input is known — pass
   `requirements` with a real market slug / 0x wallet, add their service_ids
   (above) to `SIGNAL_BUYER_ALLOWLIST`, re-`--set` on the `buyer` service.
4. **Fix the `spike:requester` replay bug** (`worker/spike-requester.ts`) — it
   resolves on ANY `order_completed` WS event, including replayed historical ones,
   so it false-"completes" on a stale order instead of the one it just negotiated.
   Minor (validation-only script), but it masked the AlphaTrack hire mid-flight.
5. **Rotate the seller + requester SDK keys** — pasted into transcripts. Regenerate
   in CROO, update `.env` + Railway (`CROO_SDK_KEY` follows the `${{…}}` reference).
6. **Delete junk Railway services** (`@hunch/oracle-web`, `degen-trader-example`,
   `probe-svc`) — dashboard only, CLI has no service-delete.
7. **Confirm CROO dashboard prices match `core/pricing.ts`** (`portfolio-hedge`
   $3.00, `scorecard` $0.10) — a mismatch corrupts the booked-revenue metric.
8. **Pick demo questions that map to OPEN Hunch markets.** The forecast test
   returned `no_market` (honest, but flat on video). Before recording, query
   `playhunch.xyz/api/partner/catalogue` for live markets and choose questions that
   return a real probability.
