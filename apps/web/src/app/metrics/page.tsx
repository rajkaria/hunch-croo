import { fetchCompletedOrders, fetchPublicAgent } from "@/lib/croo";
import { revenueByService } from "@/lib/revenue";
import { computeScorecard, readLedger } from "@/lib/scorecard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const AGENT_IDS = (
  process.env.CROO_AGENT_IDS ?? "013febe1-f57a-445d-95f4-adf2931bd2f9"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * The metric families the worker exposes at /metrics — mirrored from
 * `packages/oracle/src/core/metrics/catalog.ts` (the web app is deliberately
 * decoupled from the worker so it deploys alone). Keep in sync with the catalog.
 */
const METRIC_CATALOG: Array<{
  name: string;
  type: "counter" | "gauge";
  labels?: string[];
  help: string;
  scorecard?: boolean;
}> = [
  { name: "oracle_up", type: "gauge", help: "1 if the loop is connected to CAP, else 0." },
  { name: "oracle_uptime_seconds", type: "gauge", help: "Seconds since the loop started." },
  { name: "oracle_negotiations_total", type: "counter", labels: ["outcome"], help: "Negotiations handled (accepted|rejected)." },
  { name: "oracle_orders_total", type: "counter", labels: ["outcome"], help: "Paid orders handled (delivered|rejected|skipped_sla)." },
  { name: "oracle_orders_delivered_by_service_total", type: "counter", labels: ["service", "listing"], help: "Deliveries per service handler + listing." },
  { name: "oracle_errors_total", type: "counter", help: "Unhandled loop errors." },
  { name: "oracle_revenue_usd", type: "gauge", labels: ["service", "listing"], help: "Booked revenue at list price, per service." },
  { name: "oracle_revenue_usd_total", type: "gauge", help: "Total booked revenue at list price." },
  { name: "oracle_last_event_timestamp_seconds", type: "gauge", help: "Unix time of the last CAP event." },
  { name: "oracle_last_sweep_timestamp_seconds", type: "gauge", help: "Unix time of the last safety-net sweep." },
  { name: "oracle_forecasts_total", type: "gauge", scorecard: true, help: "Forecasts on the track-record ledger." },
  { name: "oracle_forecasts_resolved", type: "gauge", scorecard: true, help: "Recorded forecasts that have resolved + scored." },
  { name: "oracle_forecasts_pending", type: "gauge", scorecard: true, help: "Recorded forecasts awaiting resolution." },
  { name: "oracle_forecast_brier", type: "gauge", scorecard: true, help: "Mean Brier over resolved forecasts." },
  { name: "oracle_forecast_log_loss", type: "gauge", scorecard: true, help: "Mean log loss over resolved forecasts." },
  { name: "oracle_forecast_hit_rate", type: "gauge", scorecard: true, help: "Share of resolved forecasts where the called outcome occurred." },
];

export default async function MetricsPage() {
  const [orders, agents] = await Promise.all([
    fetchCompletedOrders(),
    Promise.all(AGENT_IDS.map(fetchPublicAgent)),
  ]);
  const liveAgents = agents.filter(Boolean) as NonNullable<
    Awaited<ReturnType<typeof fetchPublicAgent>>
  >[];
  const revenue = revenueByService(orders, liveAgents);
  const card = computeScorecard(readLedger());

  return (
    <main>
      <section className="hero" style={{ padding: "48px 0 32px" }}>
        <h1 style={{ fontSize: "34px" }}>
          The desk you can <em>watch</em>
        </h1>
        <p className="sub" style={{ fontSize: "15.5px" }}>
          The worker exposes a Prometheus <span className="mono">/metrics</span>{" "}
          endpoint on its ops port — throughput, uptime, booked revenue, and the
          live calibration score. Point Grafana at it and the desk becomes a
          time series. Below: the metric catalog, the live scorecard gauges, and
          settled revenue per service from the on-chain order feed.
        </p>
      </section>

      <section className="section" style={{ paddingTop: 8 }}>
        <h2>Scrape it</h2>
        <p className="lead">
          Metrics ride the same port as the status page
          (<span className="mono">ORACLE_HEALTH_PORT</span>). No new config.
        </p>
        <div className="card">
          <pre className="mono" style={{ margin: 0, fontSize: 13, overflowX: "auto" }}>
{`# prometheus.yml
scrape_configs:
  - job_name: hunch-oracle
    static_configs:
      - targets: ["oracle-worker:8080"]   # ORACLE_HEALTH_PORT

# or just:
curl -s http://localhost:8080/metrics`}
          </pre>
        </div>
      </section>

      <section className="section">
        <h2>Live scorecard gauges</h2>
        <p className="lead">
          The <span className="mono">oracle_forecast_*</span> family, computed
          from the same track-record ledger the{" "}
          <a href="/scorecard">scorecard</a> reads. Resolved forecasts only.
        </p>
        {card.total === 0 ? (
          <div className="card">
            <p>
              No forecasts recorded yet — the scorecard family appears once the
              worker runs with <span className="mono">ORACLE_LEDGER_PATH</span>{" "}
              set. Try <span className="mono">pnpm --filter @hunch/oracle smoke:metrics</span>.
            </p>
          </div>
        ) : (
          <div className="grid cols-4">
            <div className="stat">
              <div className="label">oracle_forecasts_total</div>
              <div className="value">{card.total}</div>
              <div className="hint">{card.pending} pending</div>
            </div>
            <div className="stat">
              <div className="label">oracle_forecast_brier</div>
              <div className="value accent">{card.meanBrier.toFixed(4)}</div>
              <div className="hint">0 = perfect</div>
            </div>
            <div className="stat">
              <div className="label">oracle_forecast_hit_rate</div>
              <div className="value">{card.hitRate.toFixed(2)}</div>
              <div className="hint">{card.resolved} resolved</div>
            </div>
            <div className="stat">
              <div className="label">oracle_forecast_log_loss</div>
              <div className="value">{card.meanLogLoss.toFixed(3)}</div>
              <div className="hint">clamped, finite</div>
            </div>
          </div>
        )}
      </section>

      <section className="section">
        <h2>Settled revenue per service</h2>
        <p className="lead">
          Real USDC that cleared on Base, grouped from the CROO completed-order
          feed. This is <em>settled</em> revenue — distinct from the worker&apos;s{" "}
          <span className="mono">oracle_revenue_usd</span> gauge, which is booked
          at list price from the delivery log.
        </p>
        {revenue.lines.length === 0 ? (
          <div className="card">
            <p>
              No settled orders visible yet — this feed reads the CROO API
              server-side with the provider key.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Delivered</th>
                  <th>Settled USDC</th>
                </tr>
              </thead>
              <tbody>
                {revenue.lines.map((l) => (
                  <tr key={l.serviceId}>
                    <td>{l.name}</td>
                    <td className="mono">{l.delivered}</td>
                    <td className="mono">${l.revenueUsd.toFixed(2)}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td className="mono">
                    <strong>{revenue.totalDelivered}</strong>
                  </td>
                  <td className="mono">
                    <strong>${revenue.totalUsd.toFixed(2)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <h2>Metric catalog</h2>
        <p className="lead">
          Every family the <span className="mono">/metrics</span> endpoint emits.
          The <span className="pill dim">scorecard</span> family appears only when
          the ledger is enabled.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Type</th>
                <th>Labels</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {METRIC_CATALOG.map((m) => (
                <tr key={m.name}>
                  <td className="mono">
                    {m.name}{" "}
                    {m.scorecard ? (
                      <span className="pill dim">scorecard</span>
                    ) : null}
                  </td>
                  <td className="mono">{m.type}</td>
                  <td className="mono">{m.labels?.join(", ") ?? "—"}</td>
                  <td>{m.help}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
