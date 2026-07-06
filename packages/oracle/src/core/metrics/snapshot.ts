import type { ProviderLoopHealth } from "../provider-loop.js";
import type { ServicePricing } from "../pricing.js";
import type { Rollup } from "../track-record/scoring.js";
import { METRIC_CATALOG } from "./catalog.js";
import type { Metric, MetricSample } from "./registry.js";
import { revenueByService } from "./revenue.js";

/**
 * Assemble the desk's Prometheus metric set from a point-in-time loop snapshot.
 * Pure: given the same inputs it returns the same metrics (golden-tested), so
 * `formatPrometheus(buildMetrics(...))` is byte-stable. No I/O — the caller reads
 * the loop health, per-service delivery counts, and (optionally) the scorecard
 * rollup, and hands them in.
 */
export interface MetricsInput {
  health: ProviderLoopHealth;
  deliveredByService: Record<string, number>;
  pricing: Record<string, ServicePricing>;
  /** S11 scorecard rollup — present only when the ledger is enabled. */
  rollup?: Rollup | null;
}

/** Build a Metric, pulling type + help from the catalog so nothing drifts. */
function metric(name: string, samples: MetricSample[]): Metric {
  const meta = METRIC_CATALOG[name];
  if (!meta) throw new Error(`metric not in catalog: ${name}`);
  return { name, help: meta.help, type: meta.type, samples };
}

/** ISO string → whole unix seconds, or 0 when null/unparseable. */
function unixSeconds(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

export function buildMetrics(input: MetricsInput): Metric[] {
  const { health, deliveredByService, pricing, rollup } = input;
  const s = health.stats;
  const revenue = revenueByService(deliveredByService, pricing);

  const metrics: Metric[] = [
    metric("oracle_up", [{ value: health.connected ? 1 : 0 }]),
    metric("oracle_uptime_seconds", [{ value: health.uptimeSeconds }]),
    metric("oracle_negotiations_total", [
      { value: s.negotiationsAccepted, labels: { outcome: "accepted" } },
      { value: s.negotiationsRejected, labels: { outcome: "rejected" } },
    ]),
    metric("oracle_orders_total", [
      { value: s.ordersDelivered, labels: { outcome: "delivered" } },
      { value: s.ordersRejected, labels: { outcome: "rejected" } },
      { value: s.ordersSkippedSla, labels: { outcome: "skipped_sla" } },
    ]),
    metric(
      "oracle_orders_delivered_by_service_total",
      revenue.lines.map((l) => ({
        value: l.delivered,
        labels: { service: l.service, listing: l.listing },
      })),
    ),
    metric("oracle_errors_total", [{ value: s.errors }]),
    metric(
      "oracle_revenue_usd",
      revenue.lines.map((l) => ({
        value: l.revenueUsd,
        labels: { service: l.service, listing: l.listing },
      })),
    ),
    metric("oracle_revenue_usd_total", [{ value: revenue.totalUsd }]),
    metric("oracle_last_event_timestamp_seconds", [
      { value: unixSeconds(health.lastEventAt) },
    ]),
    metric("oracle_last_sweep_timestamp_seconds", [
      { value: unixSeconds(health.lastSweepAt) },
    ]),
  ];

  // The scorecard family only exists when the ledger is enabled — otherwise the
  // desk records nothing and there is honestly nothing to report.
  if (rollup) {
    metrics.push(
      metric("oracle_forecasts_total", [{ value: rollup.total }]),
      metric("oracle_forecasts_resolved", [{ value: rollup.resolved }]),
      metric("oracle_forecasts_pending", [{ value: rollup.pending }]),
      metric("oracle_forecast_brier", [{ value: rollup.meanBrier }]),
      metric("oracle_forecast_log_loss", [{ value: rollup.meanLogLoss }]),
      metric("oracle_forecast_hit_rate", [{ value: rollup.hitRate }]),
    );
  }

  return metrics;
}
