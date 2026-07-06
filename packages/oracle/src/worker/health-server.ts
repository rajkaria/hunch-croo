import { createServer, type Server } from "node:http";
import type { ProviderLoopHealth } from "../core/provider-loop.js";
import type { OracleLogger } from "../ports/runtime.js";

/** Just the slice of the loop the status page needs — keeps this decoupled. */
export interface HealthSource {
  health(): ProviderLoopHealth;
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

/** Start a tiny JSON status server. The worker exposes it on ORACLE_HEALTH_PORT. */
export function startHealthServer(
  loop: HealthSource,
  port: number,
  logger: OracleLogger,
): Server {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
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
