# Observability — the desk you can watch (S12)

The desk already *counts* everything it does and *knows* what each service is
worth. S12 exposes that as a standard Prometheus `/metrics` endpoint and adds
deterministic revenue accounting from the desk's own delivery log — so a judge,
an SRE, or the operator can point Grafana at the worker and watch throughput,
uptime, booked revenue, and the live calibration score as a time series.

## Turn it on

Metrics ride the **same port** as the S10 status page — no new config:

```bash
ORACLE_HEALTH_PORT=8080 pnpm --filter @hunch/oracle worker
curl -s http://localhost:8080/metrics
```

```yaml
# prometheus.yml
scrape_configs:
  - job_name: hunch-oracle
    static_configs:
      - targets: ["oracle-worker:8080"]   # ORACLE_HEALTH_PORT
```

Unset `ORACLE_HEALTH_PORT` → no ops server at all; the desk behaves exactly as
before. S12 is strictly additive.

## What it exposes

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `oracle_up` | gauge | — | 1 if the loop is connected to CAP, else 0 |
| `oracle_uptime_seconds` | gauge | — | seconds since the loop started |
| `oracle_negotiations_total` | counter | `outcome` | negotiations handled (accepted\|rejected) |
| `oracle_orders_total` | counter | `outcome` | paid orders handled (delivered\|rejected\|skipped_sla) |
| `oracle_orders_delivered_by_service_total` | counter | `service`,`listing` | deliveries per service handler |
| `oracle_errors_total` | counter | — | unhandled loop errors |
| `oracle_revenue_usd` | gauge | `service`,`listing` | **booked** revenue at list price, per service |
| `oracle_revenue_usd_total` | gauge | — | total booked revenue at list price |
| `oracle_last_event_timestamp_seconds` | gauge | — | unix time of the last CAP event |
| `oracle_last_sweep_timestamp_seconds` | gauge | — | unix time of the last safety-net sweep |
| `oracle_forecasts_total` / `_resolved` / `_pending` | gauge | — | track-record ledger counts¹ |
| `oracle_forecast_brier` / `_log_loss` / `_hit_rate` | gauge | — | live calibration score¹ |

¹ The scorecard family is emitted only when the ledger is enabled
(`ORACLE_LEDGER_PATH`) — otherwise the desk records nothing and there is honestly
nothing to report.

## Booked vs settled revenue — two honest numbers

- **`oracle_revenue_usd` (this endpoint)** is *booked at list price*: the desk's
  own delivery count × the published price in `SERVICE_PRICING`. It answers "what
  did we deliver, at list price?" — computed in-process, no network, no funds.
- **The dashboard's revenue** is *settled on Base*: real USDC that cleared,
  read from the CROO order feed. It answers "what actually cleared?"

They are deliberately distinct and never conflated. The `/metrics` page on the
web app shows the settled figure grouped per service alongside the metric
catalog, so the two are easy to compare.

## Why no latency histogram

CAP gives the provider no reliable per-order *start* time, and wall-clock timing
of async handlers is non-deterministic — a histogram would be a fabricated
distribution. We omit it rather than fake it, consistent with the desk's
"never fake, never fake accuracy" rule.

## Design notes

- **Dependency-free.** The Prometheus text format is small enough to own; we do
  not pull `prom-client`. `core/metrics/registry.ts` renders the exposition and
  is golden-tested for byte-stability (sorted labels, spec-correct escaping).
- **Single source of truth.** `core/metrics/catalog.ts` holds every family's
  name/type/help; the snapshot builder and the web catalog both read from it, so
  the endpoint and its docs can't drift.
- **Fail-soft.** A ledger read error during a scrape drops the scorecard family
  and logs it — the endpoint never 500s and never blocks liveness.
- **Service-agnostic.** Revenue + throughput are keyed by handler name and driven
  by `SERVICE_PRICING`; a newly registered service (e.g. S13 `portfolio-hedge`)
  appears automatically with zero metrics-code changes.

## See it, credential-free

```bash
pnpm --filter @hunch/oracle smoke:metrics
```

Drives the real provider loop selling forecasts + a spawn, settles a couple, and
prints the exact exposition the endpoint would serve — asserting the throughput,
booked-revenue, and scorecard families. Browse the public page at `/metrics`.
