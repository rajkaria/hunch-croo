import { describe, expect, it } from "vitest";
import { formatPrometheus, type Metric } from "../src/core/metrics/registry.js";

/**
 * The dependency-free Prometheus text-exposition builder. Output must be
 * byte-stable and spec-correct: HELP/TYPE headers, sorted labels, proper
 * escaping, and honest non-finite spellings.
 */
describe("formatPrometheus", () => {
  it("renders a labelless gauge with HELP/TYPE and a trailing newline", () => {
    const metrics: Metric[] = [
      { name: "oracle_up", help: "1 if connected.", type: "gauge", samples: [{ value: 1 }] },
    ];
    expect(formatPrometheus(metrics)).toBe(
      "# HELP oracle_up 1 if connected.\n# TYPE oracle_up gauge\noracle_up 1\n",
    );
  });

  it("renders a labelled counter and sorts label keys deterministically", () => {
    const metrics: Metric[] = [
      {
        name: "oracle_orders_delivered_by_service_total",
        help: "By service.",
        type: "counter",
        samples: [
          // labels intentionally out of order — output must sort them
          { value: 3, labels: { service: "forecast", listing: "Hunch Oracle" } },
        ],
      },
    ];
    const out = formatPrometheus(metrics);
    expect(out).toContain(
      'oracle_orders_delivered_by_service_total{listing="Hunch Oracle",service="forecast"} 3\n',
    );
  });

  it("escapes label values (quote, backslash, newline)", () => {
    const metrics: Metric[] = [
      {
        name: "x",
        help: "h",
        type: "gauge",
        samples: [{ value: 1, labels: { note: 'a"b\\c\nd' } }],
      },
    ];
    expect(formatPrometheus(metrics)).toContain('x{note="a\\"b\\\\c\\nd"} 1\n');
  });

  it("escapes backslash and newline in HELP but leaves quotes alone", () => {
    const metrics: Metric[] = [
      { name: "x", help: 'path C:\\tmp\nline "q"', type: "gauge", samples: [] },
    ];
    const out = formatPrometheus(metrics);
    expect(out).toContain('# HELP x path C:\\\\tmp\\nline "q"\n');
  });

  it("emits HELP/TYPE for an empty family (no samples yet)", () => {
    const metrics: Metric[] = [
      { name: "oracle_revenue_usd", help: "revenue", type: "gauge", samples: [] },
    ];
    expect(formatPrometheus(metrics)).toBe(
      "# HELP oracle_revenue_usd revenue\n# TYPE oracle_revenue_usd gauge\n",
    );
  });

  it("renders non-finite values with the Prometheus spellings", () => {
    const metrics: Metric[] = [
      {
        name: "x",
        help: "h",
        type: "gauge",
        samples: [{ value: NaN }, { value: Infinity }, { value: -Infinity }],
      },
    ];
    const out = formatPrometheus(metrics);
    expect(out).toContain("x NaN\n");
    expect(out).toContain("x +Inf\n");
    expect(out).toContain("x -Inf\n");
  });

  it("preserves metric order and renders floats exactly", () => {
    const metrics: Metric[] = [
      { name: "a_total", help: "a", type: "counter", samples: [{ value: 10 }] },
      { name: "b_ratio", help: "b", type: "gauge", samples: [{ value: 0.25 }] },
    ];
    const out = formatPrometheus(metrics);
    expect(out.indexOf("a_total")).toBeLessThan(out.indexOf("b_ratio"));
    expect(out).toContain("b_ratio 0.25\n");
  });
});
