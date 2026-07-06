import { CrooCapTransport } from "../adapters/croo/transport.js";
import { HunchClient } from "../adapters/hunch/client.js";
import { ProviderLoop } from "../core/provider-loop.js";
import { createRegistry, type ServiceHandler } from "../core/service-registry.js";
import { echoService } from "../core/services/echo.js";
import { createForecastService } from "../core/services/forecast.js";
import { createHedgeQuoteService } from "../core/services/hedge-quote.js";
import { createResearchService } from "../core/services/research.js";
import { createSentimentService } from "../core/services/sentiment.js";
import { createScorecardService } from "../core/services/scorecard.js";
import { createSpawnService } from "../core/services/spawn.js";
import { createVerifyService } from "../core/services/verify.js";
import { createWatchService } from "../core/services/watch.js";
import { createFsLedger } from "../adapters/fs/ledger.js";
import { runSettleSweep } from "../core/track-record/settle-sweep.js";
import { rollup } from "../core/track-record/scoring.js";
import { buildMetrics } from "../core/metrics/snapshot.js";
import { formatPrometheus } from "../core/metrics/registry.js";
import { SERVICE_PRICING } from "../core/pricing.js";
import type { LedgerStore } from "../ports/ledger.js";
import { parseServiceMap, readEnv } from "../config.js";
import { consoleLogger, systemClock, systemSleeper } from "../ports/runtime.js";
import { startHealthServer, type MetricsProvider } from "./health-server.js";

/**
 * The Hunch Oracle Desk provider worker.
 * S0: echo service behind ORACLE_ECHO_ALL=true (CAP lifecycle spike).
 * S1+: real services registered via ORACLE_SERVICE_MAP.
 */
async function main() {
  const env = readEnv();
  const logger = consoleLogger;

  const hunch = new HunchClient({ baseUrl: env.HUNCH_API_URL });

  // The track record is opt-in: only when ORACLE_LEDGER_PATH is set do we
  // record forecasts, serve the scorecard, and run the settle sweep.
  const ledger: LedgerStore | null = env.ORACLE_LEDGER_PATH
    ? createFsLedger(env.ORACLE_LEDGER_PATH)
    : null;

  const HANDLERS: Record<string, ServiceHandler> = {
    echo: echoService,
    forecast: createForecastService(hunch),
    sentiment: createSentimentService(hunch),
    research: createResearchService(hunch),
    verify: createVerifyService(hunch),
    spawn: createSpawnService(hunch),
    watch: createWatchService({ hunch, sleeper: systemSleeper }),
    "hedge-quote": createHedgeQuoteService(hunch, {
      maxStakeUsd: env.HEDGE_QUOTE_MAX_STAKE_USD,
    }),
    ...(ledger ? { scorecard: createScorecardService(ledger) } : {}),
  };

  const services: Record<string, ServiceHandler> = {};
  for (const [serviceId, handlerName] of Object.entries(
    parseServiceMap(env.ORACLE_SERVICE_MAP),
  )) {
    const handler = HANDLERS[handlerName];
    if (!handler) throw new Error(`unknown handler "${handlerName}"`);
    services[serviceId] = handler;
  }

  const registry = createRegistry({
    services,
    ...(env.ORACLE_ECHO_ALL ? { fallback: echoService } : {}),
  });

  const transport = new CrooCapTransport({
    apiUrl: env.CROO_API_URL,
    wsUrl: env.CROO_WS_URL,
    sdkKey: env.CROO_SDK_KEY,
    logger,
  });

  const loop = new ProviderLoop({
    transport,
    registry,
    clock: systemClock,
    logger,
    sleeper: systemSleeper,
    deliverRetries: env.ORACLE_DELIVER_RETRIES,
    retryBaseMs: env.ORACLE_RETRY_BASE_MS,
    ...(ledger ? { ledger } : {}),
  });

  await loop.start();
  logger.info("hunch-oracle worker online", {
    echoAll: env.ORACLE_ECHO_ALL,
    mappedServices: Object.keys(services).length,
    deliverRetries: env.ORACLE_DELIVER_RETRIES,
    trackRecord: ledger ? env.ORACLE_LEDGER_PATH : "disabled",
  });

  // S12 observability: a Prometheus exposition on the same ops port as /status.
  // Booked-revenue + throughput come from the loop's in-memory counters; the
  // scorecard family (Brier, hit-rate) is read from the ledger when enabled. A
  // ledger read failure degrades to "no scorecard family", never a 500.
  const metricsProvider: MetricsProvider = {
    async render() {
      let rollupSnapshot = null;
      if (ledger) {
        try {
          rollupSnapshot = rollup(await ledger.list());
        } catch (error) {
          logger.warn("metrics: ledger read failed; omitting scorecard family", {
            error: String(error),
          });
        }
      }
      return formatPrometheus(
        buildMetrics({
          health: loop.health(),
          deliveredByService: loop.stats.deliveredByService,
          pricing: SERVICE_PRICING,
          rollup: rollupSnapshot,
        }),
      );
    },
  };

  // Optional ops server: JSON /status + /healthz for uptime checks, and the
  // Prometheus /metrics endpoint for Grafana — all on ORACLE_HEALTH_PORT.
  const healthServer =
    env.ORACLE_HEALTH_PORT !== undefined
      ? startHealthServer(loop, env.ORACLE_HEALTH_PORT, logger, metricsProvider)
      : null;

  // periodic sweep as a WS-drop / missed-event safety net
  const sweepTimer = setInterval(
    () => void loop.sweep(),
    env.ORACLE_SWEEP_INTERVAL_MS,
  );

  // Track-record settle sweep: score forecasts whose markets have resolved.
  // Fail-soft — a resolver outage is logged and retried next tick.
  const settleTimer = ledger
    ? setInterval(() => {
        void runSettleSweep({ ledger, hunch, clock: systemClock, logger })
          .then((r) => {
            if (r.scored > 0)
              logger.info("settle sweep", { ...r });
          })
          .catch((error) =>
            logger.error("settle sweep failed", { error: String(error) }),
          );
      }, env.ORACLE_SETTLE_INTERVAL_MS)
    : null;

  const shutdown = () => {
    clearInterval(sweepTimer);
    if (settleTimer) clearInterval(settleTimer);
    healthServer?.close();
    loop.stop();
    logger.info("final stats", { ...loop.stats });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[oracle] fatal", error);
  process.exit(1);
});
