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

## Hosting

[docs/DEPLOY.md](docs/DEPLOY.md) — the runbook that gets the CROO agents ONLINE.
The desk goes dark when nothing hosts the worker (the WS to CROO = the ONLINE
signal). Root `Dockerfile` + `docker-compose.yml` run two long-lived processes:
`worker` (provider desk, `pnpm --filter @hunch/oracle worker`) and `buyer`
(`signal-buyer-loop` — the long-lived, cap-safe requester; see
`core/signal-buyer/loop.ts`). `.env.example` carries the full `ORACLE_SERVICE_MAP`
(8 paid services + `scorecard`). Listing copy in `docs/LISTINGS.md`.

Sprint history (S0–S14) is in git log + `docs/*.md` (HARDENING, HEDGE-QUOTE,
SIGNAL-BUYER, LISTINGS, SCORECARD, OBSERVABILITY, PORTFOLIO-HEDGE, PY-CLIENT).
Roadmap **S11→S14 complete** (built 2026-07-06); no S15 defined — a "continue"
next session needs a fresh brainstorm.

Branch topology: `main` is at S14 (S11→S14 merged 2026-07-06). The old sprint
branches (`claude/stoic-carson-602b4d`, `claude/reverent-shirley-ac533f`, etc.)
are fully merged and safe to prune.
