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

**🔴 BUYER BLOCKED ON AN EMPTY WALLET (2026-07-20).** All four processes are up
on Railway (project **energetic-benevolence**
`117ce3e2-ca2e-4b1d-a191-36f3a6d3a442`, acct rajkaria98@gmail.com, deploys from
`main`) and all three sellers log `websocket connected`. But the buyer has
created **300+ orders since 2026-07-19T18:25Z and settled ZERO** — every one is
stuck in `creating`.

**Root cause: the buyer's ERC-4337 smart account is empty.** Not a code bug —
the create UserOp reverts on-chain every time:

- buyer smart account `0xfb115215ad8cdd36dc5647fd4a4a1e29ad8d95e4`
- **0 ETH · 0.002034 USDC · 0 EntryPoint deposit**
- e.g. create tx `0xc5f5b7af…` → EntryPoint v0.7 receipt is `status 0x1` (so it
  *looks* mined) but the logs carry `UserOperationPrefundTooLow` and
  `UserOperationEvent.success = false`. The CROO paymaster
  (`0x2cc0c7981d846b9f2a16276556f6e8cb52bfb633`) holds 1.119 ETH but is not
  sponsoring these ops, so prefund falls to the sender — which has nothing.
- `chainOrderId` stays `"0"`, `price`/`payDeadline` stay empty → the order never
  becomes payable → CROO leaves it `creating` forever.

**A green EntryPoint receipt is NOT proof of settlement.** The earlier
"buyer LIVE and PAYING, tx `0x68b045eb…`" claim was read off a tx status alone;
always decode `UserOperationEvent.success` before believing a UserOp landed.

**Unblock = fund `0xfb115215ad8cdd36dc5647fd4a4a1e29ad8d95e4` on Base** with
USDC (spend) + a little ETH (prefund, unless CROO sponsors gas). At the $5/day
cap the 17-entry allowlist burns ~$1.52/round. Nothing else is in the way — the
allowlist, caps and loop are all correctly configured and provably placing
orders.

Gate green: typecheck + **281 oracle tests** + 9 CAP-client.

| Railway service | Config | Notes |
|---|---|---|
| `worker-oracle` | root `railway.json` | volume `/app/data` (ledger); real service UUIDs mapped |
| `worker-truthcheck` | root `railway.json` | `trackRecord: disabled` — ledger is Oracle's |
| `worker-marketdesk` | root `railway.json` | hedge caps set; real UUIDs mapped |
| `buyer` | `railway.buyer.json` | **placing orders, settling none — wallet empty** (see root cause above). Allowlist widened 2026-07-20 to **17 services across 11 counterparty agents**; caps $5/day · $1/order · **$0.60/counterparty/day**; round interval 1h |

**Orders placed (live CROO, real Base USDC):**
- `forecast` self-hire — **completed**, $0.25 (integration test, NOT traction). Full
  lifecycle `created→paying→paid→delivering→evaluating→completed`, real tx hashes.
  Handler searched 198 open Hunch markets, returned `no_market` + near-misses +
  provenance (fail-soft held — never faked a probability).
- AlphaTrack `top_traders` external hire — **completed**, $0.10 (paid by hand via
  raw API). Real Binance top-trader leaderboard, on-chain `deliverTxHash`. Proved
  the fiber-extracted service_id is genuine AND that a full external hire settles.
- **One genuine external customer.** `scorecard`, $0.01, 2026-07-15, requester
  agent `ecce23e6-5005-4aa6-b3a3-5381434e9e50` — NOT one of ours, and not in the
  20-agent public directory (unlisted). The only inbound money to date.
- **Buyer loop: 300+ orders, 0 settled** — all `creating`, empty wallet (above).
  The old `invalid_price: NaN` self-reject IS fixed (`6a9d06e`); this is a
  different, purely financial blocker sitting downstream of it.

**The store is quiet — that is the opportunity.** Full sweep on 2026-07-20:
20 agents, 43 services, and almost every one shows `orders7d: 0`. The busiest
listings are SwapGod (5054), AlphaTrack `top_traders` (7075) and Polymind
(1683); essentially everything else is at zero. A funded buyer clearing ~30-90
cheap orders/day would make this desk the most active non-swap counterparty on
the network within a day.

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

1. ~~**FIX THE BUYER PRICE BUG**~~ **✅ FIXED & CONFIRMED ON LIVE (2026-07-15, main
   `6a9d06e`).** The committed diagnosis was WRONG on two counts — a diagnostic
   deploy (`e606363`) captured the real created-order shape:
   `price: "100000"` (NOT empty — USDC **base units**, ÷1e6 = $0.10),
   `amount: "100000.00000000"` (same value), and
   `paymentToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"` — the USDC
   **contract address**, not the ticker "USDC". So the NaN came from the token
   guard rejecting anything but literal "USDC", and the value was base units, not
   dollars (the first fix, deriving from `amount`, still self-rejected because the
   token check failed first). Fix: `policy.orderPriceUsd` recognises USDC by
   contract address (or ticker) and reads price/amount as **base units ÷ 1e6**;
   removed the decimal-dollars `parsePriceUsd`. **The mock now emits the real wire
   shape** (base units + USDC address) so a conversion bug fails a test — the
   lesson from "mocks agreed with the code, not CROO". CONFIRMED live: a loop order
   paid escrow, `priceUsd: 0.1`, tx `0x68b045eb…`, spend under the $5/day cap.
   Order sits at `paid` awaiting counterparty delivery to reach `completed`.
2. **Seed inbound demand from other teams** (the real traction number). Post the
   hire-swap in the hackathon channel: "drop your service_id, I'll route real
   orders to it." Each becomes a genuine external order on our sellers (currently
   1 provider order total — the AlphaTrack test was us hiring *out*).
3. **Add the two Polymarket counterparties** once a valid input is known — pass
   `requirements` with a real market slug / 0x wallet, add their service_ids
   (above) to `SIGNAL_BUYER_ALLOWLIST`, re-`--set` on the `buyer` service.
4. ~~**Fix the `spike:requester` replay bug**~~ **✅ FIXED (2026-07-15).** The CAP
   WS replays historical events on connect, so a driver that acts on the first
   `order_completed` false-"completes" on a stale order. New tested
   `core/signal-buyer/correlate.ts#PurchaseCorrelator` scopes a purchase to one
   order; `spike-requester.ts` uses strict negotiation-match, and **`buyOnce`
   (the buyer money path, same bug class) now owns terminal events by order id**
   too. Residual (documented): a replayed *still-open* `created` order arriving
   before `buyOnce` learns its negotiation id — low-harm, cap-safe.
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
