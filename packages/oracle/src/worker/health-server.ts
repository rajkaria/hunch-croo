import { createServer, type Server } from "node:http";
import type { ProviderLoopHealth } from "../core/provider-loop.js";
import type { OracleLogger } from "../ports/runtime.js";

/** Just the slice of the loop the status page needs — keeps this decoupled. */
export interface HealthSource {
  health(): ProviderLoopHealth;
}

/**
 * Renders the Prometheus exposition on demand (async: it may read the ledger).
 * Supplied by the worker; when absent, `/metrics` 404s like any unknown path.
 */
export interface MetricsProvider {
  render(): Promise<string>;
}

const PATHS = new Set(["/", "/healthz", "/status"]);

/**
 * Map a request path to a status-page response. Pure, so it's fully unit-tested
 * without binding a socket. `connected:false` returns 503 so orchestrators
 * (Railway/k8s) and uptime checks treat a dropped worker as unhealthy.
 */
export function healthResponse(
  loop: HealthSource,
  path: string,
): { statusCode: number; body: string } {
  if (!PATHS.has(path)) {
    return { statusCode: 404, body: JSON.stringify({ error: "not found" }) };
  }
  const health = loop.health();
  return {
    statusCode: health.connected ? 200 : 503,
    body: JSON.stringify(health, null, 2),
  };
}

/** The Prometheus content type CAP scrapers / Grafana expect. */
export const PROM_CONTENT_TYPE = "text/plain; version=0.0.4";

/** Pure mapping for a rendered exposition → a 200 text/plain response. */
export function metricsResponse(text: string): {
  statusCode: number;
  contentType: string;
  body: string;
} {
  return { statusCode: 200, contentType: PROM_CONTENT_TYPE, body: text };
}

/**
 * Start a tiny ops server on ORACLE_HEALTH_PORT. Serves the JSON status page
 * (`/`, `/healthz`, `/status`) and, when a `metrics` provider is supplied, the
 * Prometheus exposition at `/metrics`. A render failure returns 500 but never
 * takes down the liveness routes.
 */
export function startHealthServer(
  loop: HealthSource,
  port: number,
  logger: OracleLogger,
  metrics?: MetricsProvider,
): Server {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    if (path === "/metrics" && metrics) {
      metrics
        .render()
        .then((text) => {
          const { statusCode, contentType, body } = metricsResponse(text);
          res.writeHead(statusCode, { "content-type": contentType });
          res.end(body);
        })
        .catch((error) => {
          logger.error("metrics render failed", { error: String(error) });
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "metrics render failed" }));
        });
      return;
    }
    const { statusCode, body } = healthResponse(loop, path);
    res.writeHead(statusCode, { "content-type": "application/json" });
    res.end(body);
  });
  server.listen(port, () =>
    logger.info("health server listening", {
      port: (server.address() as { port?: number } | null)?.port ?? port,
    }),
  );
  return server;
}
