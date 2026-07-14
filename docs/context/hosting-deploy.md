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
updated: 2026-07-14
---

# Hosting — get the CROO agents ONLINE (S15)

Merged to `main` as `2f4ff8b` (2026-07-14). Gate green: typecheck + **256 tests**.

## Current state — what's working, deployed, broken

**The diagnosis.** The CROO agent dashboard showed two agents OFFLINE with ~$0
activity. Two independent causes, neither a code bug:

1. **Nothing hosted the worker.** The desk is a long-lived process whose live
   WebSocket to CROO *is* the ONLINE signal (`worker/main.ts` → `ProviderLoop`).
   It had only ever been run from a laptop. Close the laptop → agent goes dark.
2. **Nothing real was listed.** `ORACLE_SERVICE_MAP` contained exactly one entry:
   `echo`, the S0 spike endpoint. All 8 paid services existed in code and none
   were purchasable. The lone $0.01 order on the dashboard was someone hitting
   the echo test.

**Shipped.** Root `Dockerfile` (node:22-slim, runs TS on `tsx` — no build step,
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

**Unverified:** the Docker image *build* itself — still no Docker daemon in the dev
sandbox. The image's `pnpm` behaviour is verified by faithful simulation (same
install command, same pruned layout), but `docker build` has never been run.

## Recent changes — files touched and why

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

## Next steps — specific, actionable

1. **Redeploy on Railway with the fix.** FOUR Railway services from this repo (one
   per process — Railway has no compose): three workers on `railway.json` +
   `buyer` on `railway.buyer.json`, each with its own `CROO_SDK_KEY` +
   `ORACLE_SERVICE_MAP`, Root Directory `/`, **Start Command box left empty**, and
   a Volume at `/app/data` on `worker-oracle` only (the ledger). Full table in
   `docs/DEPLOY.md` → Railway. Verify: `/healthz` → `"connected": true`.
2. **Rotate the three seller SDK keys.** They were pasted into a chat transcript on
   2026-07-14. Regenerate in the CROO dashboard, update `.env` and the host's
   variables, redeploy. Do this *after* hosting — don't let it block step 1.
3. **Confirm the CROO dashboard prices match `core/pricing.ts`** — specifically
   `portfolio-hedge` = $3.00 and `scorecard` = $0.10. A mismatch silently corrupts
   the booked-revenue metric.
4. **`docker build` the image once for real** — it has never been built (no Docker
   in the dev sandbox). Any fix belongs in the root `Dockerfile`.
5. **(Later) Take the buyer live.** It deploys in dry-run and spends nothing. To
   arm it: fill `SIGNAL_BUYER_ALLOWLIST` with vetted counterparties, set
   `SIGNAL_BUYER_ENABLED=true`. Caps: $5/UTC-day, $1/order. Leave off until the
   sellers have proven themselves.
