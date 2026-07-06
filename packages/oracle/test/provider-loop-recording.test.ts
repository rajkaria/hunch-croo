import { describe, expect, it } from "vitest";
import { MockCapTransport } from "../src/adapters/mock/transport.js";
import { ProviderLoop } from "../src/core/provider-loop.js";
import { createRegistry, type ServiceHandler } from "../src/core/service-registry.js";
import { createMockLedger } from "../src/adapters/mock/ledger.js";
import type { LedgerStore } from "../src/ports/ledger.js";
import type { Clock, OracleLogger } from "../src/ports/runtime.js";

const fixedClock: Clock = { now: () => new Date("2026-07-06T00:00:00.000Z") };
const silent: OracleLogger = { info() {}, warn() {}, error() {} };

/** A forecast service stub that returns a scoreable forecast/ok payload. */
const forecastStub: ServiceHandler = {
  name: "forecast",
  handle: async () => ({
    service: "forecast",
    status: "ok",
    question: "Will AIXBT close above $1?",
    probability: 0.34,
    side: "yes",
    marketId: "mkt_aixbt",
    marketSlug: "aixbt-above-1",
    marketUrl: "https://www.playhunch.xyz/m/aixbt-above-1",
    deadlineAt: "2026-12-31T00:00:00.000Z",
    odds: { yes: 34, no: 66 },
    confidence: "high",
  }),
};

const echoStub: ServiceHandler = {
  name: "echo",
  handle: async () => ({ service: "echo", status: "ok", echoed: {} }),
};

function makeLoop(handler: ServiceHandler, ledger?: LedgerStore) {
  const transport = new MockCapTransport();
  const registry = createRegistry({ services: { "svc-x": handler } });
  const loop = new ProviderLoop({
    transport,
    registry,
    clock: fixedClock,
    logger: silent,
    ...(ledger ? { ledger } : {}),
  });
  return { transport, loop };
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 10));
}

async function deliverOne(handler: ServiceHandler, ledger?: LedgerStore) {
  const { transport, loop } = makeLoop(handler, ledger);
  await loop.start();
  transport.createNegotiation({ serviceId: "svc-x", requirements: "{}" });
  await settle();
  transport.payOrder("order-2");
  await settle();
  return { transport, loop };
}

describe("ProviderLoop track-record recording", () => {
  it("records a delivered forecast exactly once, with its delivery txHash", async () => {
    const ledger = createMockLedger();
    const { loop } = await deliverOne(forecastStub, ledger);
    expect(loop.stats.ordersDelivered).toBe(1);

    const records = await ledger.list();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      orderId: "order-2",
      txHash: "0xclearorder-2",
      marketId: "mkt_aixbt",
      predictedOutcomeKey: "yes",
      probability: 0.34,
      resolution: null,
    });
  });

  it("records nothing for a non-forecast service", async () => {
    const ledger = createMockLedger();
    await deliverOne(echoStub, ledger);
    expect(await ledger.list()).toHaveLength(0);
  });

  it("never records twice for the same order under a duplicate paid event", async () => {
    const ledger = createMockLedger();
    const { transport, loop } = await deliverOne(forecastStub, ledger);
    // Duplicate order_paid replay after completion must not re-record.
    transport.replayPaid("order-2");
    await settle();
    expect(loop.stats.ordersDelivered).toBe(1);
    expect(await ledger.list()).toHaveLength(1);
  });

  it("does NOT fail a paid delivery when the ledger append throws (advisory recording)", async () => {
    const brokenLedger: LedgerStore = {
      append: async () => {
        throw new Error("disk full");
      },
      list: async () => [],
      head: async () => null,
    };
    const { transport, loop } = await deliverOne(forecastStub, brokenLedger);
    // Delivery still succeeded and the order cleared — money path is untouched.
    expect(transport.deliveries.get("order-2")).toBeDefined();
    expect((await transport.getOrder("order-2")).status).toBe("completed");
    expect(loop.stats.ordersDelivered).toBe(1);
    expect(loop.stats.errors).toBe(0); // a ledger failure is not a loop error
  });

  it("works with no ledger configured (recording is optional)", async () => {
    const { transport, loop } = await deliverOne(forecastStub);
    expect(loop.stats.ordersDelivered).toBe(1);
    expect(transport.deliveries.get("order-2")).toBeDefined();
  });
});
