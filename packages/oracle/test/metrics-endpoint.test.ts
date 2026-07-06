import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import {
  healthResponse,
  metricsResponse,
  startHealthServer,
  type HealthSource,
  type MetricsProvider,
} from "../src/worker/health-server.js";
import type { ProviderLoopHealth } from "../src/core/provider-loop.js";
import type { OracleLogger } from "../src/ports/runtime.js";

const silent: OracleLogger = { info() {}, warn() {}, error() {} };

function fakeLoop(connected = true): HealthSource {
  const health: ProviderLoopHealth = {
    status: connected ? "ok" : "stopped",
    connected,
    startedAt: "2026-07-06T00:00:00.000Z",
    lastEventAt: null,
    lastSweepAt: null,
    uptimeSeconds: 1,
    stats: {
      negotiationsAccepted: 0,
      negotiationsRejected: 0,
      ordersDelivered: 0,
      ordersRejected: 0,
      ordersSkippedSla: 0,
      errors: 0,
      deliveredByService: {},
    },
  };
  return { health: () => health };
}

/** startHealthServer already calls listen(); just wait until it's bound. */
function listen(server: Server): Promise<number> {
  const port = () => {
    const addr = server.address();
    return typeof addr === "object" && addr ? addr.port : 0;
  };
  return new Promise((resolve) => {
    if (server.listening) resolve(port());
    else server.once("listening", () => resolve(port()));
  });
}

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

describe("metricsResponse", () => {
  it("wraps rendered text as a 200 Prometheus response", () => {
    const r = metricsResponse("oracle_up 1\n");
    expect(r.statusCode).toBe(200);
    expect(r.contentType).toBe("text/plain; version=0.0.4");
    expect(r.body).toBe("oracle_up 1\n");
  });
});

describe("healthResponse (unchanged by S12)", () => {
  it("still serves /status as JSON and 404s unknown paths", () => {
    const loop = fakeLoop();
    expect(healthResponse(loop, "/status").statusCode).toBe(200);
    expect(healthResponse(loop, "/nope").statusCode).toBe(404);
    // /metrics is not a healthResponse path — the server routes it separately
    expect(healthResponse(loop, "/metrics").statusCode).toBe(404);
  });
});

describe("startHealthServer with a metrics provider", () => {
  it("serves /metrics from the provider and keeps /status as JSON", async () => {
    const metrics: MetricsProvider = {
      render: async () => "oracle_up 1\noracle_uptime_seconds 1\n",
    };
    server = startHealthServer(fakeLoop(), 0, silent, metrics);
    const port = await listen(server);

    const m = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(m.status).toBe(200);
    expect(m.headers.get("content-type")).toBe("text/plain; version=0.0.4");
    expect(await m.text()).toContain("oracle_up 1");

    const s = await fetch(`http://127.0.0.1:${port}/status`);
    expect(s.headers.get("content-type")).toBe("application/json");
    const body = (await s.json()) as { connected: boolean };
    expect(body.connected).toBe(true);
  });

  it("404s /metrics when no provider is configured", async () => {
    server = startHealthServer(fakeLoop(), 0, silent);
    const port = await listen(server);
    const m = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(m.status).toBe(404);
  });

  it("returns 500 (not a crash) when the provider render throws", async () => {
    const metrics: MetricsProvider = {
      render: async () => {
        throw new Error("ledger exploded");
      },
    };
    server = startHealthServer(fakeLoop(), 0, silent, metrics);
    const port = await listen(server);
    const m = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(m.status).toBe(500);
    // liveness route still works after a metrics failure
    const s = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(s.status).toBe(200);
  });
});
