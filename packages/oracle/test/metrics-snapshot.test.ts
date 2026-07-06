import { describe, expect, it } from "vitest";
import { buildMetrics } from "../src/core/metrics/snapshot.js";
import { formatPrometheus } from "../src/core/metrics/registry.js";
import { SERVICE_PRICING } from "../src/core/pricing.js";
import type { ProviderLoopHealth } from "../src/core/provider-loop.js";
import type { Rollup } from "../src/core/track-record/scoring.js";

function health(overrides: Partial<ProviderLoopHealth> = {}): ProviderLoopHealth {
  return {
    status: "ok",
    connected: true,
    startedAt: "2026-07-06T00:00:00.000Z",
    lastEventAt: "2026-07-06T00:01:00.000Z", // unix 1751760060
    lastSweepAt: null,
    uptimeSeconds: 120,
    stats: {
      negotiationsAccepted: 5,
      negotiationsRejected: 1,
      ordersDelivered: 4,
      ordersRejected: 2,
      ordersSkippedSla: 0,
      errors: 0,
      deliveredByService: { forecast: 3, spawn: 1 },
    },
    ...overrides,
  };
}

function lines(text: string): string[] {
  return text.trim().split("\n");
}

describe("buildMetrics", () => {
  it("maps liveness + counters to the catalog families", () => {
    const out = formatPrometheus(
      buildMetrics({
        health: health(),
        deliveredByService: { forecast: 3, spawn: 1 },
        pricing: SERVICE_PRICING,
      }),
    );
    const l = lines(out);
    expect(l).toContain("oracle_up 1");
    expect(l).toContain("oracle_uptime_seconds 120");
    expect(l).toContain('oracle_negotiations_total{outcome="accepted"} 5');
    expect(l).toContain('oracle_negotiations_total{outcome="rejected"} 1');
    expect(l).toContain('oracle_orders_total{outcome="delivered"} 4');
    expect(l).toContain('oracle_orders_total{outcome="skipped_sla"} 0');
    expect(l).toContain("oracle_errors_total 0");
    const eventSeconds = Math.floor(Date.parse("2026-07-06T00:01:00.000Z") / 1000);
    expect(l).toContain(`oracle_last_event_timestamp_seconds ${eventSeconds}`);
    expect(l).toContain("oracle_last_sweep_timestamp_seconds 0");
  });

  it("emits per-service throughput and booked revenue", () => {
    const out = formatPrometheus(
      buildMetrics({
        health: health(),
        deliveredByService: { forecast: 3, spawn: 1 },
        pricing: SERVICE_PRICING,
      }),
    );
    const l = lines(out);
    expect(l).toContain(
      'oracle_orders_delivered_by_service_total{listing="Hunch Oracle",service="forecast"} 3',
    );
    // forecast 3 x $0.25 = $0.75 ; spawn 1 x $2.50 = $2.50 ; total $3.25
    expect(l).toContain(
      'oracle_revenue_usd{listing="Hunch Oracle",service="forecast"} 0.75',
    );
    expect(l).toContain(
      'oracle_revenue_usd{listing="Hunch Market Desk",service="spawn"} 2.5',
    );
    expect(l).toContain("oracle_revenue_usd_total 3.25");
  });

  it("reports oracle_up 0 when the loop is disconnected", () => {
    const out = formatPrometheus(
      buildMetrics({
        health: health({ connected: false, status: "stopped" }),
        deliveredByService: {},
        pricing: SERVICE_PRICING,
      }),
    );
    expect(lines(out)).toContain("oracle_up 0");
  });

  it("omits the scorecard family when no rollup is provided", () => {
    const out = formatPrometheus(
      buildMetrics({
        health: health(),
        deliveredByService: {},
        pricing: SERVICE_PRICING,
      }),
    );
    expect(out).not.toContain("oracle_forecast_brier");
    expect(out).not.toContain("oracle_forecasts_total");
  });

  it("emits the scorecard family when a rollup is provided", () => {
    const rollup: Rollup = {
      total: 6,
      resolved: 5,
      pending: 1,
      hits: 4,
      hitRate: 0.8,
      meanBrier: 0.12,
      meanLogLoss: 0.4,
      calibration: [],
    };
    const out = formatPrometheus(
      buildMetrics({
        health: health(),
        deliveredByService: {},
        pricing: SERVICE_PRICING,
        rollup,
      }),
    );
    const l = lines(out);
    expect(l).toContain("oracle_forecasts_total 6");
    expect(l).toContain("oracle_forecasts_resolved 5");
    expect(l).toContain("oracle_forecasts_pending 1");
    expect(l).toContain("oracle_forecast_brier 0.12");
    expect(l).toContain("oracle_forecast_hit_rate 0.8");
  });

  it("is byte-deterministic for identical inputs", () => {
    const input = {
      health: health(),
      deliveredByService: { forecast: 3, spawn: 1 },
      pricing: SERVICE_PRICING,
    };
    expect(formatPrometheus(buildMetrics(input))).toBe(
      formatPrometheus(buildMetrics(input)),
    );
  });
});
