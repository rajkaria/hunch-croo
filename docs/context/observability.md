---
feature: Observability — Prometheus metrics + revenue (S12)
globs:
  - packages/oracle/src/core/metrics/**
  - packages/oracle/src/worker/health-server.ts
  - packages/oracle/src/worker/smoke-metrics.ts
  - apps/web/src/app/metrics/**
  - apps/web/src/lib/revenue.ts
  - docs/OBSERVABILITY.md
  - packages/oracle/test/{metrics-registry,metrics-revenue,metrics-snapshot,metrics-endpoint}.test.ts
updated: 2026-07-06
---

# Observability (S12)

Exposes the desk's internals as a standard Prometheus `/metrics` endpoint plus
deterministic revenue accounting. Point Grafana at the worker and watch
throughput, uptime, booked revenue, and the live calibration score.

## Current state — what's working

- **Green + shipped** on branch `claude/reverent-shirley-ac533f` (commit `6f084cc`,
  hardened by review commit `8301834`). `pnpm gate` passes.
- Dependency-free Prometheus text exposition (`core/metrics/registry.ts`) — no
  `prom-client`; golden-tested for byte-stability (sorted labels, spec escaping,
  non-finite spellings, empty families still emit HELP/TYPE).
- `core/metrics/catalog.ts` is the single source of truth for metric
  names/types/help; `snapshot.ts` builds the metric set from a loop health
  snapshot + `deliveredByService` + `SERVICE_PRICING` + (optional) S11 rollup.
- `revenue.ts` = booked revenue at list price (delivered × price), unpriced
  services counted at $0. Deliberately DISTINCT from settled USDC.
- Served on the existing `ORACLE_HEALTH_PORT` at `/metrics` (async route added to
  `health-server.ts`, fail-soft: a ledger read error drops the scorecard family,
  never 500s). Wired in `worker/main.ts`.
- Provider loop gained one additive field: `stats.deliveredByService` (per-handler
  delivery counter), incremented only on real delivery.
- Web `/metrics` page: live scorecard gauges (from the ledger) + settled revenue
  per service (from CROO order feed via `lib/revenue.ts`) + the metric catalog +
  a scrape runbook. Nav link added in `apps/web/src/app/layout.tsx`.
- Demo: `pnpm --filter @hunch/oracle smoke:metrics` (asserts independent literals).

## Key decisions

- Own the Prometheus format rather than add `prom-client` — honesty/zero-dep ethos.
- **No latency histogram**: CAP gives no reliable per-order start time; faking a
  distribution would violate "never fake". Omitted on purpose.
- Booked-at-list-price (this endpoint) vs settled-on-Base (dashboard) are two
  honest numbers, never conflated. The web page shows both, labelled.
- Zero new required config — metrics ride the ops port.

## Next steps (optional, not yet scoped)

- Ship a Grafana dashboard JSON (currently documented, not bundled).
- Consider a fulfilment-duration summary IF a reliable injected timing source
  appears (keep it deterministic under a fake clock).
