import { describe, expect, it } from "vitest";
import { MockCapTransport } from "../src/adapters/mock/transport.js";
import { ProviderLoop } from "../src/core/provider-loop.js";
import {
  createRegistry,
  type ServiceHandler,
} from "../src/core/service-registry.js";
import { echoService } from "../src/core/services/echo.js";
import type { Clock, OracleLogger } from "../src/ports/runtime.js";

const fixedClock: Clock = { now: () => new Date("2026-07-06T00:00:00.000Z") };
const silentLogger: OracleLogger = { info() {}, warn() {}, error() {} };

function makeLoop(options?: {
  services?: Record<string, ServiceHandler>;
  fallback?: ServiceHandler;
}) {
  const transport = new MockCapTransport();
  const registry = createRegistry({
    services: options?.services ?? { "svc-echo": echoService },
    ...(options?.fallback ? { fallback: options.fallback } : {}),
  });
  const loop = new ProviderLoop({
    transport,
    registry,
    clock: fixedClock,
    logger: silentLogger,
  });
  return { transport, loop };
}

async function settle() {
  // let queued microtasks from event handlers drain
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 10));
}

describe("ProviderLoop", () => {
  it("accepts a known-service negotiation, delivers on payment, order clears", async () => {
    const { transport, loop } = makeLoop();
    await loop.start();

    transport.createNegotiation({
      serviceId: "svc-echo",
      requirements: JSON.stringify({ question: "up or down?" }),
    });
    await settle();

    const paid = [...transport.deliveries.keys()];
    expect(paid).toHaveLength(0); // not paid yet → nothing delivered

    transport.payOrder("order-2");
    await settle();

    const delivery = transport.deliveries.get("order-2");
    expect(delivery).toBeDefined();
    const payload = JSON.parse(delivery!.text!);
    expect(payload.service).toBe("echo");
    expect(payload.echoed).toEqual({ question: "up or down?" });
    expect(payload.asOf).toBe("2026-07-06T00:00:00.000Z");
    expect((await transport.getOrder("order-2")).status).toBe("completed");
    expect(loop.stats).toMatchObject({
      negotiationsAccepted: 1,
      ordersDelivered: 1,
    });
  });

  it("rejects negotiations for unknown services", async () => {
    const { transport, loop } = makeLoop();
    await loop.start();

    const negotiation = transport.createNegotiation({ serviceId: "svc-nope" });
    await settle();

    expect(
      transport.rejectedNegotiations.get(negotiation.negotiationId),
    ).toMatch(/unknown service/);
    expect(loop.stats.negotiationsRejected).toBe(1);
  });

  it("rejects fund-transfer negotiations even for known services", async () => {
    const { transport, loop } = makeLoop();
    await loop.start();

    const negotiation = transport.createNegotiation({
      serviceId: "svc-echo",
      fundAmount: "1000000",
    });
    await settle();

    expect(
      transport.rejectedNegotiations.get(negotiation.negotiationId),
    ).toMatch(/fund-transfer/);
  });

  it("delivers each paid order exactly once under duplicate order_paid events", async () => {
    const { transport, loop } = makeLoop();
    await loop.start();
    transport.createNegotiation({ serviceId: "svc-echo" });
    await settle();

    transport.payOrder("order-2");
    await settle();
    // duplicate event replay: loop must not double-deliver (mock throws if it does)
    // @ts-expect-error reaching into private emit is fine for the test
    transport.listener?.({ type: "order_paid", orderId: "order-2", raw: {} });
    await settle();

    expect(loop.stats.ordersDelivered).toBe(1);
    expect(loop.stats.errors).toBe(0);
  });

  it("rejects the order (escrow refund) when the handler throws — never fakes output", async () => {
    const failing: ServiceHandler = {
      name: "broken",
      handle: async () => {
        throw new Error("upstream source unavailable");
      },
    };
    const { transport, loop } = makeLoop({ services: { "svc-x": failing } });
    await loop.start();

    transport.createNegotiation({ serviceId: "svc-x" });
    await settle();
    transport.payOrder("order-2");
    await settle();

    expect(transport.deliveries.size).toBe(0);
    expect(transport.rejectedOrders.get("order-2")).toMatch(
      /upstream source unavailable/,
    );
    expect((await transport.getOrder("order-2")).status).toBe("rejected");
  });

  it("startup sweep processes negotiations and paid orders queued while offline", async () => {
    const transport = new MockCapTransport();
    // queue work BEFORE the loop exists (worker was offline)
    transport.createNegotiation({
      serviceId: "svc-echo",
      requirements: '{"q":1}',
    });

    const registry = createRegistry({ services: { "svc-echo": echoService } });
    const loop = new ProviderLoop({
      transport,
      registry,
      clock: fixedClock,
      logger: silentLogger,
    });
    await loop.start(); // sweep accepts the pending negotiation
    await settle();
    transport.payOrder("order-2");
    await settle();

    expect(loop.stats.negotiationsAccepted).toBe(1);
    expect(loop.stats.ordersDelivered).toBe(1);
  });

  it("fallback handler (spike mode) answers unmapped services when enabled", async () => {
    const { transport, loop } = makeLoop({
      services: {},
      fallback: echoService,
    });
    await loop.start();

    transport.createNegotiation({ serviceId: "svc-anything" });
    await settle();
    transport.payOrder("order-2");
    await settle();

    expect(loop.stats.ordersDelivered).toBe(1);
  });

  it("deliverable bytes are stable: redelivery of the same order reproduces identical text", async () => {
    const { transport: t1 } = makeLoop();
    const { transport: t2 } = makeLoop();
    for (const transport of [t1, t2]) {
      const registry = createRegistry({
        services: { "svc-echo": echoService },
      });
      const loop = new ProviderLoop({
        transport,
        registry,
        clock: fixedClock,
        logger: silentLogger,
      });
      await loop.start();
      transport.createNegotiation({
        serviceId: "svc-echo",
        requirements: '{"a":1,"b":2}',
      });
      await settle();
      transport.payOrder("order-2");
      await settle();
    }
    expect(t1.deliveries.get("order-2")!.text).toBe(
      t2.deliveries.get("order-2")!.text,
    );
  });
});
