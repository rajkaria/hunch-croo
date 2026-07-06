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

Sprint history (S0–S11) is in git log + `docs/*.md` (HARDENING, HEDGE-QUOTE,
SIGNAL-BUYER, LISTINGS, SCORECARD). Roadmap: S12 observability, S13 portfolio
hedge, S14 Python SDK.
