import type { MetricType } from "./registry.js";

/**
 * The single source of truth for the desk's metric families — names, types,
 * labels, and help text. The snapshot builder (`snapshot.ts`), the smoke demo,
 * and the public web catalog all read from here, so the endpoint and its docs
 * can never drift apart.
 *
 * Naming follows Prometheus conventions: `oracle_` prefix, `_total` suffix for
 * counters, base-unit suffixes (`_seconds`, `_usd`) for gauges.
 */
export interface MetricMeta {
  type: MetricType;
  help: string;
  labels?: string[];
  /** True for the S11 scorecard family — only emitted when the ledger is on. */
  scorecard?: boolean;
}

export const METRIC_CATALOG: Record<string, MetricMeta> = {
  oracle_up: {
    type: "gauge",
    help: "1 if the provider loop is connected to CAP, else 0.",
  },
  oracle_uptime_seconds: {
    type: "gauge",
    help: "Seconds since the provider loop started.",
  },
  oracle_negotiations_total: {
    type: "counter",
    help: "CAP negotiations handled, by outcome (accepted|rejected).",
    labels: ["outcome"],
  },
  oracle_orders_total: {
    type: "counter",
    help: "Paid orders handled, by outcome (delivered|rejected|skipped_sla).",
    labels: ["outcome"],
  },
  oracle_orders_delivered_by_service_total: {
    type: "counter",
    help: "Orders delivered, broken down by service handler and its Store listing.",
    labels: ["service", "listing"],
  },
  oracle_errors_total: {
    type: "counter",
    help: "Unhandled errors caught in the event loop.",
  },
  oracle_revenue_usd: {
    type: "gauge",
    help: "Booked revenue at list price (delivered count x price), per service. NOT the on-chain settled total — see the dashboard for that.",
    labels: ["service", "listing"],
  },
  oracle_revenue_usd_total: {
    type: "gauge",
    help: "Total booked revenue at list price across all delivered services.",
  },
  oracle_last_event_timestamp_seconds: {
    type: "gauge",
    help: "Unix time of the last CAP event the loop processed (0 if none yet).",
  },
  oracle_last_sweep_timestamp_seconds: {
    type: "gauge",
    help: "Unix time of the last safety-net sweep (0 if none yet).",
  },
  oracle_forecasts_total: {
    type: "gauge",
    help: "Forecasts recorded to the track-record ledger.",
    scorecard: true,
  },
  oracle_forecasts_resolved: {
    type: "gauge",
    help: "Recorded forecasts whose markets have resolved and been scored.",
    scorecard: true,
  },
  oracle_forecasts_pending: {
    type: "gauge",
    help: "Recorded forecasts still awaiting market resolution.",
    scorecard: true,
  },
  oracle_forecast_brier: {
    type: "gauge",
    help: "Mean Brier score over resolved forecasts (0 = perfect, 0.25 = coin-flip).",
    scorecard: true,
  },
  oracle_forecast_log_loss: {
    type: "gauge",
    help: "Mean log loss over resolved forecasts (clamped, always finite).",
    scorecard: true,
  },
  oracle_forecast_hit_rate: {
    type: "gauge",
    help: "Fraction of resolved forecasts where the called outcome occurred.",
    scorecard: true,
  },
};
