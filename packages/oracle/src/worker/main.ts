import { CrooCapTransport } from "../adapters/croo/transport.js";
import { HunchClient } from "../adapters/hunch/client.js";
import { ProviderLoop } from "../core/provider-loop.js";
import { createRegistry, type ServiceHandler } from "../core/service-registry.js";
import { echoService } from "../core/services/echo.js";
import { createForecastService } from "../core/services/forecast.js";
import { createResearchService } from "../core/services/research.js";
import { createSentimentService } from "../core/services/sentiment.js";
import { createSpawnService } from "../core/services/spawn.js";
import { createVerifyService } from "../core/services/verify.js";
import { parseServiceMap, readEnv } from "../config.js";
import { consoleLogger, systemClock } from "../ports/runtime.js";

/**
 * The Hunch Oracle Desk provider worker.
 * S0: echo service behind ORACLE_ECHO_ALL=true (CAP lifecycle spike).
 * S1+: real services registered via ORACLE_SERVICE_MAP.
 */
async function main() {
  const env = readEnv();
  const logger = consoleLogger;

  const hunch = new HunchClient({ baseUrl: env.HUNCH_API_URL });
  const HANDLERS: Record<string, ServiceHandler> = {
    echo: echoService,
    forecast: createForecastService(hunch),
    sentiment: createSentimentService(hunch),
    research: createResearchService(hunch),
    verify: createVerifyService(hunch),
    spawn: createSpawnService(hunch),
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
  });

  await loop.start();
  logger.info("hunch-oracle worker online", {
    echoAll: env.ORACLE_ECHO_ALL,
    mappedServices: Object.keys(services).length,
  });

  const shutdown = () => {
    loop.stop();
    logger.info("final stats", { ...loop.stats });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // periodic sweep as a WS-drop safety net
  setInterval(() => void loop.sweep(), 60_000);
}

main().catch((error) => {
  console.error("[oracle] fatal", error);
  process.exit(1);
});
