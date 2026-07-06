# S12 — Observability ("the desk you can watch")

**Status:** approved design · **Date:** 2026-07-06 · **Sprint:** S12

Part of the S11→S14 roadmap (track-record → **observability** → portfolio hedge
→ Python SDK). S11 made the desk *auditable* (was it right?). S12 makes it
*watchable* (is it alive, busy, earning?) — a Prometheus `/metrics` endpoint plus
deterministic revenue accounting the desk computes from its own delivery log.

## The problem it kills

The desk runs a real provider process that already counts everything it does
(`ProviderLoopStats`) and knows what each service is worth (`SERVICE_PRICING`),
but none of it is exposed in a form ops tooling can scrape. A judge, an SRE, or
the operator can curl `/status` for liveness — but there is no time-series
surface (Prometheus/Grafana), and no answer to "what has this desk *earned*"
except the external CROO dashboard read. S12 exposes the internals as standard
Prometheus metrics and adds a deterministic revenue rollup from the desk's own
books.

## Scope

In scope:
- A dependency-free Prometheus **text-exposition** builder (no `prom-client`;
  honest, auditable, matches the repo's zero-runtime-dep ethos).
- A pure **metric snapshot** that renders counters + gauges from the loop's
  health/stats, the scorecard rollup (when the ledger is on), and revenue.
- A **per-service delivery counter** added to the provider loop (`deliveredByService`)
  — the one new piece of loop state, strictly additive.
- Deterministic **revenue analytics**: delivered-count × list price per service,
  from `SERVICE_PRICING`. Labelled as *booked revenue at list price*, never
  conflated with the on-chain settled total the dashboard reads.
- A `/metrics` route served on the existing `ORACLE_HEALTH_PORT` (zero new
  required config; if the ops port is on, you also get metrics).
- A public **`/metrics` catalog + live ops** web page.
- A `smoke:metrics` demo + `docs/OBSERVABILITY.md` + README section.

Out of scope: latency histograms (CAP gives us no reliable per-order start time,
and wall-clock timing is non-deterministic — we do not fabricate a distribution);
alerting rules; a bundled Grafana dashboard JSON (documented, not shipped);
scoring changes (S11 owns scoring).

## Architecture

Fits the existing `ports`/`adapters`/`core` split. New core lives under
`core/metrics/`; all pure and golden-tested. The HTTP surface reuses the S10
health server, generalized to also answer `/metrics`.

### New core — `core/metrics/`

**`registry.ts`** — the Prometheus text format, dependency-free.

```ts
export type MetricType = "counter" | "gauge";
export interface MetricSample { value: number; labels?: Record<string, string>; }
export interface Metric { name: string; help: string; type: MetricType; samples: MetricSample[]; }
export function formatPrometheus(metrics: Metric[]): string;
```

- Emits `# HELP <name> <help>` and `# TYPE <name> <type>` once per metric, then
  one line per sample: `name{k="v",...} value`.
- Deterministic: label keys sorted; help/label values escaped per the exposition
  spec (`\\`, `\n`, and `"` in label values). Non-finite values (NaN/Inf) are
  rendered as Prometheus `NaN`/`+Inf`/`-Inf` — but the snapshot never produces
  them (S11 rollup is NaN-free), this is defence-in-depth.
- Trailing newline; stable metric order (input order preserved).

**`catalog.ts`** — the single source of truth for the metric family names +
help text, so the endpoint, the smoke assertions, and the web catalog page never
drift.

```ts
export const METRIC_CATALOG = [
  { name: "oracle_up", type: "gauge", help: "1 if the provider loop is connected to CAP, else 0." },
  { name: "oracle_uptime_seconds", type: "gauge", help: "..." },
  { name: "oracle_negotiations_total", type: "counter", help: "...", labels: ["outcome"] },
  { name: "oracle_orders_total", type: "counter", help: "...", labels: ["outcome"] },
  { name: "oracle_orders_delivered_by_service_total", type: "counter", help: "...", labels: ["service", "listing"] },
  { name: "oracle_errors_total", type: "counter", help: "..." },
  { name: "oracle_revenue_usd", type: "gauge", help: "Booked revenue at list price...", labels: ["service", "listing"] },
  { name: "oracle_revenue_usd_total", type: "gauge", help: "..." },
  { name: "oracle_last_event_timestamp_seconds", type: "gauge", help: "..." },
  { name: "oracle_last_sweep_timestamp_seconds", type: "gauge", help: "..." },
  // scorecard family (only emitted when the ledger is enabled):
  { name: "oracle_forecasts_total", type: "gauge", help: "..." },
  { name: "oracle_forecasts_resolved", type: "gauge", help: "..." },
  { name: "oracle_forecasts_pending", type: "gauge", help: "..." },
  { name: "oracle_forecast_brier", type: "gauge", help: "..." },
  { name: "oracle_forecast_log_loss", type: "gauge", help: "..." },
  { name: "oracle_forecast_hit_rate", type: "gauge", help: "..." },
] as const;
```

**`revenue.ts`** — pure booked-revenue rollup.

```ts
export interface RevenueLine { service: string; listing: string; delivered: number; priceUsd: number; revenueUsd: number; }
export interface RevenueRollup { lines: RevenueLine[]; totalDelivered: number; totalUsd: number; }
export function revenueByService(
  deliveredByService: Record<string, number>,
  pricing: Record<string, ServicePricing>,
): RevenueRollup;
```

- One line per delivered service; `revenueUsd = delivered × priceUsd` (rounded to
  cents). A delivered service with no pricing row (e.g. `echo`, `scorecard`)
  contributes `priceUsd: 0` and is still counted in `delivered`. Lines sorted by
  `service` for determinism. `totalUsd` sums the lines.

**`snapshot.ts`** — assemble the `Metric[]` from injected inputs (no I/O).

```ts
export interface MetricsInput {
  health: ProviderLoopHealth;                 // from loop.health()
  deliveredByService: Record<string, number>; // from loop.stats
  pricing: Record<string, ServicePricing>;
  rollup?: Rollup | null;                      // S11 scorecard, when ledger on
}
export function buildMetrics(input: MetricsInput): Metric[];
```

- Maps health/stats → the counter/gauge families in the catalog. `oracle_up`
  from `health.connected`; timestamps from `lastEventAt`/`lastSweepAt` as unix
  seconds (0 when null). The scorecard family is appended only when `rollup` is
  present. Revenue lines come from `revenueByService`.

### Loop change — one additive field

`ProviderLoopStats` gains `deliveredByService: Record<string, number>`, seeded
`{}`, incremented by `handler.name` right where `ordersDelivered` increments.
`health()` already spreads `stats`, so it flows out unchanged. Every existing
scalar field and every existing test is untouched (additive). This is the only
edit to `provider-loop.ts`.

> **Forward-reference (S13):** the revenue + delivery metrics are keyed by
> handler name and driven entirely by `SERVICE_PRICING`. When S13 registers
> `portfolio-hedge` and adds its pricing row, it appears in `/metrics` and the
> revenue rollup with **zero** additional code here.

### HTTP — generalize the health server

`worker/health-server.ts` gains an optional async metrics provider:

```ts
export interface MetricsProvider { render(): Promise<string>; } // Prometheus text
export function startHealthServer(
  loop: HealthSource, port: number, logger: OracleLogger,
  metrics?: MetricsProvider,
): Server;
```

- New pure `metricsResponse(text): { statusCode; body; contentType }` (200,
  `text/plain; version=0.0.4`).
- The server routes `/metrics` to the provider when present (async handler),
  else 404. `/`, `/healthz`, `/status` behave exactly as before.
- `worker/main.ts` builds the provider as a closure over the loop + pricing +
  (optional) ledger: on each scrape it reads `loop.health()`,
  `loop.stats.deliveredByService`, and — when a ledger is configured —
  `rollup(await ledger.list())`, then `formatPrometheus(buildMetrics(...))`.
  Ledger read failure is caught → metrics still render (scorecard family
  omitted), never 500. Served whenever `ORACLE_HEALTH_PORT` is set.

### Web — `apps/web/src/app/metrics/page.tsx`

A public **observability** page (server component), two halves:
1. **Live ops snapshot** it can compute honestly server-side: the scorecard
   family (reuse `readLedger`/`computeScorecard` from S11) and the revenue
   *model* (the pricing table × the CROO completed-order counts per service,
   grouped from `fetchCompletedOrders` + the agent's listed service names).
   Empty-state honest when there's no data.
2. **Metric catalog** rendered from a mirrored copy of `METRIC_CATALOG` (name,
   type, labels, help) + a short "point Prometheus/Grafana at
   `http://<worker>:$ORACLE_HEALTH_PORT/metrics`" runbook and an example scrape.

Nav gains a "Metrics" link (`apps/web/src/app/layout.tsx`).

## Data flow

```
loop delivers order ─▶ stats.ordersDelivered++ ; stats.deliveredByService[handler]++
GET /metrics ─▶ buildMetrics({ health, deliveredByService, pricing, rollup? })
             ─▶ formatPrometheus(...) ─▶ text/plain exposition
Prometheus ──scrape──▶ Grafana time-series (uptime, throughput, revenue, Brier)
```

## Honesty & safety invariants

- **No fabricated numbers.** Revenue is *booked at list price* from real
  delivered counts, explicitly labelled distinct from the on-chain settled total.
  Latency is omitted rather than faked.
- **Additive & opt-in.** Metrics ride the existing ops port; unset → the worker
  behaves exactly as before. No new required env.
- **Never in a money path.** Read-only observation; no LLM, no funds.
- **Fail-soft.** A ledger read error during a scrape omits the scorecard family;
  the endpoint never 500s and never blocks liveness.
- **Deterministic.** `formatPrometheus` + `buildMetrics` are pure and
  golden-tested; label ordering and escaping are stable.

## Testing (all credential-free, mock-driven)

- `metrics-registry.test.ts` — golden exposition text; label sorting; value
  escaping; empty metric; NaN/Inf rendering.
- `metrics-revenue.test.ts` — per-service revenue math; unpriced service → $0 but
  counted; totals; sort order; empty map → zeros.
- `metrics-snapshot.test.ts` — `oracle_up` 1/0; timestamps; counter families from
  a stats fixture; scorecard family present only when rollup passed; golden full
  exposition for a fixed input.
- `metrics-endpoint.test.ts` — `metricsResponse` shape + content-type;
  `healthResponse` unchanged for the other paths; provider render integrates.
- `provider-loop.test.ts` (extended) — a delivered order increments
  `deliveredByService[handler]`; two services tracked independently; existing
  assertions unchanged.

`pnpm gate` stays green.

## Config additions

None required. Documented in `.env.example`: `/metrics` is served on
`ORACLE_HEALTH_PORT` when set (same port as `/status`). No new variable.

## File manifest

New:
- `packages/oracle/src/core/metrics/{registry,catalog,revenue,snapshot}.ts`
- `packages/oracle/src/worker/smoke-metrics.ts`
- `packages/oracle/test/{metrics-registry,metrics-revenue,metrics-snapshot,metrics-endpoint}.test.ts`
- `apps/web/src/app/metrics/page.tsx`
- `apps/web/src/lib/revenue.ts` (web-side pricing×orders grouping)
- `docs/OBSERVABILITY.md`

Modified:
- `packages/oracle/src/core/provider-loop.ts` (add `deliveredByService`)
- `packages/oracle/src/worker/health-server.ts` (metrics route + provider)
- `packages/oracle/src/worker/main.ts` (wire the provider)
- `packages/oracle/test/provider-loop.test.ts` (per-service assertion)
- `packages/oracle/package.json` (`smoke:metrics`), `.env.example`, `README.md`,
  `apps/web/src/app/layout.tsx` (nav link)
