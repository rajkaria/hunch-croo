import { fetchCompletedOrders, fetchPublicAgent } from "@/lib/croo";
import { revenueByService } from "@/lib/revenue";
import { computeScorecard, readLedger } from "@/lib/scorecard";
import { PageHero, Section, StatBar, StatCell } from "../_components/Chrome";

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
      <PageHero
        kicker="Observability"
        title={
          <>
            The desk you can <em>watch.</em>
          </>
        }
      >
        The worker exposes a Prometheus <span className="mono">/metrics</span>{" "}
        endpoint on its ops port — throughput, uptime, booked revenue, and the
        live calibration score. Point Grafana at it and the desk becomes a time
        series. Below: the metric catalog, the live scorecard gauges, and
        settled revenue per service from the on-chain order feed.
      </PageHero>

      <Section index="01" kicker="Scrape it">
        <h2 className="sec-h2 sm">
          One endpoint, <em>zero dependencies.</em>
        </h2>
        <p className="sec-lead">
          Metrics ride the same port as the status page (
          <span className="mono">ORACLE_HEALTH_PORT</span>). No new config.
        </p>
        <pre style={{ marginTop: 32 }}>
{`# prometheus.yml
scrape_configs:
  - job_name: hunch-oracle
    static_configs:
      - targets: ["oracle-worker:8080"]   # ORACLE_HEALTH_PORT

# or just:
curl -s http://localhost:8080/metrics`}
        </pre>
      </Section>

      <Section index="02" kicker="Scorecard gauges" tone="cyan">
        <h2 className="sec-h2 sm">
          Calibration, <em>as a time series.</em>
        </h2>
        <p className="sec-lead">
          The <span className="mono">oracle_forecast_*</span> family, computed
          from the same track-record ledger the{" "}
          <a href="/scorecard">scorecard</a> reads. Resolved forecasts only.
        </p>
        <div style={{ marginTop: 32 }}>
          {card.total === 0 ? (
            <div className="card">
              <p>
                No forecasts recorded yet — the scorecard family appears once
                the worker runs with{" "}
                <span className="mono">ORACLE_LEDGER_PATH</span> set. Try{" "}
                <span className="mono">
                  pnpm --filter @hunch/oracle smoke:metrics
                </span>
                .
              </p>
            </div>
          ) : (
            <div className="grid cols-4">
              <div className="card">
                <p className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                  oracle_forecasts_total
                </p>
                <h3 style={{ fontSize: 26, marginTop: 6 }}>{card.total}</h3>
                <p style={{ fontSize: 12.5 }}>{card.pending} pending</p>
              </div>
              <div className="card">
                <p className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                  oracle_forecast_brier
                </p>
                <h3 style={{ fontSize: 26, marginTop: 6, color: "var(--accent)" }}>
                  {card.meanBrier.toFixed(4)}
                </h3>
                <p style={{ fontSize: 12.5 }}>0 = perfect</p>
              </div>
              <div className="card">
                <p className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                  oracle_forecast_hit_rate
                </p>
                <h3 style={{ fontSize: 26, marginTop: 6 }}>{card.hitRate.toFixed(2)}</h3>
                <p style={{ fontSize: 12.5 }}>{card.resolved} resolved</p>
              </div>
              <div className="card">
                <p className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                  oracle_forecast_log_loss
                </p>
                <h3 style={{ fontSize: 26, marginTop: 6 }}>
                  {card.meanLogLoss.toFixed(3)}
                </h3>
                <p style={{ fontSize: 12.5 }}>clamped, finite</p>
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section index="03" kicker="Revenue">
        <h2 className="sec-h2 sm">
          Settled USDC, <em>per service.</em>
        </h2>
        <p className="sec-lead">
          Real USDC that cleared on Base, grouped from the CROO completed-order
          feed. This is <em>settled</em> revenue — distinct from the
          worker&apos;s <span className="mono">oracle_revenue_usd</span> gauge,
          which is booked at list price from the delivery log.
        </p>
        <div style={{ marginTop: 32 }}>
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
        </div>
      </Section>

      <Section index="04" kicker="Metric catalog" tone="violet">
        <h2 className="sec-h2 sm">
          Every family the endpoint <em>emits.</em>
        </h2>
        <p className="sec-lead">
          The <span className="pill dim">scorecard</span> family appears only
          when the ledger is enabled.
        </p>
        <div className="table-wrap" style={{ marginTop: 32 }}>
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
      </Section>
    </main>
  );
}
