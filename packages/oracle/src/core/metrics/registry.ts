/**
 * A dependency-free Prometheus text-exposition builder. We deliberately do NOT
 * pull `prom-client`: the desk's whole ethos is honest, auditable, zero-runtime-
 * dep code, and the exposition format is small enough to own outright. Pure and
 * golden-tested — the output is byte-stable for a given metric set.
 *
 * Format (v0.0.4): per metric a `# HELP` and `# TYPE` line, then one sample line
 * per series: `name{label="value",...} value`. Label keys are sorted so the same
 * metric set always renders identically.
 */

export type MetricType = "counter" | "gauge";

export interface MetricSample {
  value: number;
  labels?: Record<string, string>;
}

export interface Metric {
  name: string;
  help: string;
  type: MetricType;
  samples: MetricSample[];
}

/** Escape a HELP string: backslash and newline only (Prometheus rule). */
function escapeHelp(help: string): string {
  return help.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

/** Escape a label value: backslash, double-quote, and newline. */
function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

/**
 * Render a numeric sample value. Finite numbers use their natural JS string
 * form (integers stay integral, e.g. `10`; floats like `0.25` render exactly).
 * Non-finite values map to the Prometheus spellings — defence-in-depth: the
 * snapshot never emits these (the S11 rollup is NaN-free), but a formatter that
 * silently drops them would hide a bug.
 */
function formatValue(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "+Inf";
  if (value === -Infinity) return "-Inf";
  return String(value);
}

/** Render `{k="v",...}` with keys sorted, or "" when there are no labels. */
function formatLabels(labels?: Record<string, string>): string {
  if (!labels) return "";
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  const inner = keys
    .map((k) => `${k}="${escapeLabelValue(labels[k]!)}"`)
    .join(",");
  return `{${inner}}`;
}

/**
 * Render a full exposition. Metric order is preserved (the caller controls it);
 * a metric with no samples still emits its HELP/TYPE header (a known-but-empty
 * family, e.g. per-service delivery counts before the first delivery). Ends with
 * a trailing newline.
 */
export function formatPrometheus(metrics: Metric[]): string {
  const lines: string[] = [];
  for (const metric of metrics) {
    lines.push(`# HELP ${metric.name} ${escapeHelp(metric.help)}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);
    for (const sample of metric.samples) {
      lines.push(
        `${metric.name}${formatLabels(sample.labels)} ${formatValue(sample.value)}`,
      );
    }
  }
  return lines.join("\n") + "\n";
}
