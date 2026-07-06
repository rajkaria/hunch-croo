import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  healthResponse,
  startHealthServer,
} from "../src/worker/health-server.js";
import type { ProviderLoopHealth } from "../src/core/provider-loop.js";

const silentLogger = { info() {}, warn() {}, error() {} };

function fakeHealth(overrides: Partial<ProviderLoopHealth> = {}): ProviderLoopHealth {
  return {
    status: "ok",
    connected: true,
    startedAt: "2026-07-06T00:00:00.000Z",
    lastEventAt: null,
    lastSweepAt: "2026-07-06T00:00:00.000Z",
    uptimeSeconds: 12,
    stats: {
      negotiationsAccepted: 3,
      negotiationsRejected: 1,
      ordersDelivered: 2,
      ordersRejected: 0,
      ordersSkippedSla: 0,
      errors: 0,
    },
    ...overrides,
  };
}

function stubLoop(health: ProviderLoopHealth) {
  return { health: () => health };
}

describe("healthResponse", () => {
  it("returns 200 + the health JSON when connected", () => {
    const res = healthResponse(stubLoop(fakeHealth()), "/healthz");
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("ok");
    expect(body.stats.ordersDelivered).toBe(2);
  });

  it("returns 503 when the loop is not connected (fails a liveness probe)", () => {
    const res = healthResponse(
      stubLoop(fakeHealth({ connected: false, status: "stopped" })),
      "/status",
    );
    expect(res.statusCode).toBe(503);
  });

  it("404s an unknown path", () => {
    const res = healthResponse(stubLoop(fakeHealth()), "/secrets");
    expect(res.statusCode).toBe(404);
  });
});

describe("startHealthServer (integration)", () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  });

  async function listen(loop: { health: () => ProviderLoopHealth }) {
    server = startHealthServer(loop, 0, silentLogger);
    await new Promise<void>((r) => server!.once("listening", () => r()));
    const port = (server.address() as AddressInfo).port;
    return `http://127.0.0.1:${port}`;
  }

  it("serves /healthz and /status over HTTP and 404s the rest", async () => {
    const base = await listen(stubLoop(fakeHealth()));

    const healthz = await fetch(`${base}/healthz`);
    expect(healthz.status).toBe(200);
    const body = (await healthz.json()) as ProviderLoopHealth;
    expect(body.stats.negotiationsAccepted).toBe(3);

    const status = await fetch(`${base}/status`);
    expect(status.status).toBe(200);

    const missing = await fetch(`${base}/nope`);
    expect(missing.status).toBe(404);
  });
});
