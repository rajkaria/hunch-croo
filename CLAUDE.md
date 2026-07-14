# Hunch Oracle Desk — context index

Per-feature context lives in `docs/context/`. The router loads the doc(s) whose
`globs:` match the files you touch — keep this file a thin index, no session prose.

Project: CAP (CROO Agent Protocol) provider desk selling prediction-market-backed
services (forecast, sentiment, research, verify, watch, spawn, hedge-quote,
scorecard) + a bidirectional signal-buyer. Monorepo: `packages/oracle` (core desk,
ports/adapters/core, mock-tested), `packages/client` (npm CAP client), `apps/web`
(Next.js surfaces). `pnpm gate` = typecheck + tests (credential-free).

## Context docs

| Doc | Covers |
|-----|--------|
| [docs/context/track-record-scorecard.md](docs/context/track-record-scorecard.md) | S11 track-record scorecard: forecast ledger (hash-chained), scoring (Brier/calibration), settle sweep, `scorecard` service, `/scorecard` web page |
| [docs/context/observability.md](docs/context/observability.md) | S12 observability: dependency-free Prometheus `/metrics` (`core/metrics/**`), booked-revenue accounting, per-service delivery counter, `/metrics` web page |
| [docs/context/portfolio-hedge.md](docs/context/portfolio-hedge.md) | S13 portfolio-hedge: shared `core/hedge/leg.ts` `priceLeg`, deterministic allocator, `portfolio-hedge` service + correlation flag (also covers `hedge-quote.ts`) |
| [docs/context/py-client.md](docs/context/py-client.md) | S14 Python SDK: `packages/py-client` (zero-dep stdlib CAP client), unittest suite, CI `py-client` job |
| [docs/context/hosting-deploy.md](docs/context/hosting-deploy.md) | S15 hosting: root `Dockerfile` + `docker-compose.yml` + `railway*.json` (3 seller workers, one per CROO agent, + cap-safe `signal-buyer-loop`), 9-service catalogue, `docs/DEPLOY.md` runbook. **Live on Railway — agents ONLINE** |

## Hosting

[docs/DEPLOY.md](docs/DEPLOY.md) — the runbook that gets the CROO agents ONLINE.
The desk goes dark when nothing hosts the worker (the live WS to CROO = the ONLINE
signal). Root `Dockerfile` + `docker-compose.yml` run FOUR long-lived processes:
one seller worker **per CROO agent** (`worker-oracle` :8080, `worker-truthcheck`
:8081, `worker-marketdesk` :8082 — a worker authenticates as exactly one agent) plus
`buyer` (`signal-buyer-loop`, the cap-safe requester; see `core/signal-buyer/loop.ts`).
Nine services listed; `scorecard` is priced at the $0.10 CROO floor and must stay on
the Oracle agent. Listing copy in `docs/LISTINGS.md`.

On Railway it's four services (no compose): `railway.json` (workers) +
`railway.buyer.json` pin the Dockerfile builder and start command — **never type a
Start Command into the dashboard**; a recursive `pnpm -r start` is what crashed the
first deploy. Every start path (`CMD`, `pnpm start`, `pnpm -r start`) now boots the
worker, and the image prunes `apps/` so recursion can't reach `next`.

Sprint history (S0–S14) is in git log + `docs/*.md` (HARDENING, HEDGE-QUOTE,
SIGNAL-BUYER, LISTINGS, SCORECARD, OBSERVABILITY, PORTFOLIO-HEDGE, PY-CLIENT).
Roadmap **S11→S15 complete**; no S16 defined — a "continue" next session needs a
fresh brainstorm.

Branch topology: `main` is at S15 + the Railway hosting hotfix (`68d42b7`,
2026-07-14). Old sprint branches (`claude/stoic-carson-602b4d`,
`claude/reverent-shirley-ac533f`, etc.) are fully merged and safe to prune.
