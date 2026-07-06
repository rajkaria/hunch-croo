import { describe, expect, it } from "vitest";
import { MockCapTransport } from "../src/adapters/mock/transport.js";
import { ProviderLoop } from "../src/core/provider-loop.js";
import {
  createRegistry,
  type ServiceHandler,
} from "../src/core/service-registry.js";
import { echoService } from "../src/core/services/echo.js";
import type { Clock, OracleLogger, Sleeper } from "../src/ports/runtime.js";

const silentLogger: OracleLogger = { info() {}, warn() {}, error() {} };

/** A clock the test can advance to model wall-clock passing mid-work. */
function mutableClock(startIso: string) {
  let ms = new Date(startIso).getTime();
  return {
    clock: { now: () => new Date(ms) } as Clock,
    advance: (deltaMs: number) => {
      ms += deltaMs;
    },
  };
}

/** Instant sleeper — retries/backoffs don't slow the suite. */
const instantSleeper: Sleeper = { sleep: async () => {} };

function makeLoop(opts?: {
  services?: Record<string, ServiceHandler>;
  clock?: Clock;
  transport?: MockCapTransport;
  retries?: number;
}) {
  const transport = opts?.transport ?? new MockCapTransport();
  const registry = createRegistry({
    services: opts?.services ?? { "svc-echo": echoService },
  });
  const loop = new ProviderLoop({
    transport,
    registry,
    clock: opts?.clock ?? { now: () => new Date("2026-07-06T00:00:00.000Z") },
    logger: silentLogger,
    sleeper: instantSleeper,
    deliverRetries: opts?.retries ?? 0,
  });
  return { transport, loop };
}

async function settle() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 10));
}

describe("S10 chaos — SLA expiry", () => {
  it("does not deliver an order whose SLA deadline already passed", async () => {
    const { transport, loop } = makeLoop({
      clock: { now: () => new Date("2026-07-06T00:00:00.000Z") },
    });
    await loop.start();
    transport.createNegotiation({
      serviceId: "svc-echo",
      requirements: "{}",
      slaDeadline: "2026-07-05T23:00:00.000Z", // 1h in the past
    });
    await settle();
    transport.payOrder("order-2");
    await settle();

    expect(transport.deliveries.size).toBe(0);
    expect(loop.stats.ordersDelivered).toBe(0);
    expect(loop.stats.ordersSkippedSla).toBe(1);
  });

  it("does not deliver when the SLA expires mid-work", async () => {
    const { clock, advance } = mutableClock("2026-07-06T00:00:00.000Z");
    // deadline 1s out: valid at fulfil start, blown by the time the handler returns
    const slow: ServiceHandler = {
      name: "slow",
      handle: async () => {
        advance(5000); // 5s of "work" pushes us past the deadline
        return { ok: true };
      },
    };
    const { transport, loop } = makeLoop({
      services: { "svc-slow": slow },
      clock,
    });
    await loop.start();
    transport.createNegotiation({
      serviceId: "svc-slow",
      requirements: "{}",
      slaDeadline: "2026-07-06T00:00:01.000Z",
    });
    await settle();
    transport.payOrder("order-2");
    await settle();

    expect(transport.deliveries.size).toBe(0);
    expect(loop.stats.ordersSkippedSla).toBe(1);
  });

  it("delivers normally when the SLA deadline is comfortably in the future", async () => {
    const { transport, loop } = makeLoop({
      clock: { now: () => new Date("2026-07-06T00:00:00.000Z") },
    });
    await loop.start();
    transport.createNegotiation({
      serviceId: "svc-echo",
      requirements: "{}",
      slaDeadline: "2026-07-06T01:00:00.000Z", // 1h out
    });
    await settle();
    transport.payOrder("order-2");
    await settle();

    expect(transport.deliveries.size).toBe(1);
    expect(loop.stats.ordersDelivered).toBe(1);
    expect(loop.stats.ordersSkippedSla).toBe(0);
  });
});

describe("S10 — health snapshot", () => {
  it("reports liveness, connection, timestamps, uptime and stats", async () => {
    const { clock, advance } = mutableClock("2026-07-06T00:00:00.000Z");
    const { transport, loop } = makeLoop({ clock });

    const before = loop.health();
    expect(before.connected).toBe(false);
    expect(before.status).toBe("starting");
    expect(before.startedAt).toBe(null);

    await loop.start(); // sets startedAt + runs a sweep
    const h1 = loop.health();
    expect(h1.connected).toBe(true);
    expect(h1.status).toBe("ok");
    expect(h1.startedAt).toBe("2026-07-06T00:00:00.000Z");
    expect(h1.lastSweepAt).toBe("2026-07-06T00:00:00.000Z");
    expect(h1.uptimeSeconds).toBe(0);

    advance(5000);
    transport.createNegotiation({ serviceId: "svc-echo" });
    await settle();
    const h2 = loop.health();
    expect(h2.lastEventAt).toBe("2026-07-06T00:00:05.000Z");
    expect(h2.uptimeSeconds).toBe(5);
    expect(h2.stats.negotiationsAccepted).toBe(1);

    loop.stop();
    expect(loop.health().connected).toBe(false);
    expect(loop.health().status).toBe("stopped");
  });
});

describe("S10 chaos — reconnect storm (duplicate events)", () => {
  it("accepts a negotiation exactly once under a storm of duplicate negotiation_created", async () => {
    const { transport, loop } = makeLoop();
    await loop.start();
    const neg = transport.createNegotiation({ serviceId: "svc-echo" });
    // WS reconnect replays the same event several times, concurrently
    transport.replayNegotiationCreated(neg.negotiationId);
    transport.replayNegotiationCreated(neg.negotiationId);
    transport.replayNegotiationCreated(neg.negotiationId);
    await settle();

    expect(loop.stats.negotiationsAccepted).toBe(1);
    expect(loop.stats.errors).toBe(0);
  });

  it("delivers exactly once under a storm of duplicate order_paid", async () => {
    const { transport, loop } = makeLoop();
    await loop.start();
    transport.createNegotiation({ serviceId: "svc-echo" });
    await settle();

    transport.payOrder("order-2");
    transport.replayPaid("order-2");
    transport.replayPaid("order-2");
    await settle();

    expect(loop.stats.ordersDelivered).toBe(1);
    expect(loop.stats.errors).toBe(0);
    expect(transport.deliveries.size).toBe(1);
  });
});

describe("S10 chaos — transient deliver failures & crash recovery", () => {
  it("retries a transient deliver failure and delivers exactly once", async () => {
    const { transport, loop } = makeLoop({ retries: 3 });
    await loop.start();
    transport.createNegotiation({ serviceId: "svc-echo" });
    await settle();
    transport.failDelivers(2, "throw-before"); // 2 blips, then success
    transport.payOrder("order-2");
    await settle();

    expect(transport.deliveries.size).toBe(1);
    expect(transport.deliverAttempts).toBe(1); // exactly one real delivery
    expect(loop.stats.ordersDelivered).toBe(1);
  });

  it("no stuck escrow: exhausted retries leave the order paid for a later sweep to deliver once", async () => {
    const { transport, loop } = makeLoop({ retries: 2 });
    await loop.start();
    transport.createNegotiation({ serviceId: "svc-echo" });
    await settle();
    // more failures than the retry budget → first fulfil gives up
    transport.failDelivers(3, "throw-before");
    transport.payOrder("order-2");
    await settle();

    expect(transport.deliveries.size).toBe(0); // not delivered yet
    expect((await transport.getOrder("order-2")).status).toBe("paid"); // escrow intact
    expect(loop.stats.ordersDelivered).toBe(0);

    // the periodic sweep (WS-drop safety net) picks it up; faults are spent now
    await loop.sweep();
    await settle();

    expect(transport.deliveries.size).toBe(1);
    expect(transport.deliverAttempts).toBe(1);
    expect(loop.stats.ordersDelivered).toBe(1);
  });

  it("crash after on-chain deliver but before local commit: never double-delivers", async () => {
    const transport = new MockCapTransport();
    const { loop } = makeLoop({ transport, retries: 0 });
    await loop.start();
    transport.createNegotiation({ serviceId: "svc-echo" });
    await settle();
    // deliver lands on-chain, then the response is lost
    transport.failDelivers(1, "throw-after");
    transport.payOrder("order-2");
    await settle();

    expect(transport.deliveries.size).toBe(1);
    expect(transport.deliverAttempts).toBe(1);
    // graceful in-process: we recognise the landed delivery, count it once, no error
    expect(loop.stats.ordersDelivered).toBe(1);
    expect(loop.stats.errors).toBe(0);

    // a freshly restarted worker (empty in-memory state) sweeps the same CAP
    const { loop: restarted } = makeLoop({ transport, retries: 0 });
    await restarted.start(); // sweep runs
    await settle();

    // the order is already completed on CAP → not re-delivered
    expect(transport.deliveries.size).toBe(1);
    expect(transport.deliverAttempts).toBe(1);
    expect(restarted.stats.ordersDelivered).toBe(0);
  });

  it("never delivers after an order was rejected, even if a stale order_paid replays", async () => {
    const { transport, loop } = makeLoop();
    await loop.start();
    transport.createNegotiation({ serviceId: "svc-echo" });
    await settle();
    // order rejected/refunded (requester withdrew, or SLA expiry) after creation
    await transport.rejectOrder("order-2", "requester withdrew after paying");
    // a duplicate/stale order_paid arrives for the now-terminal order
    transport.replayPaid("order-2");
    await settle();

    expect(transport.deliveries.size).toBe(0);
    expect(loop.stats.ordersDelivered).toBe(0);
    expect(loop.stats.errors).toBe(0);
  });

  it("stops cleanly (no error, no wasted retries) if the order is rejected while the handler runs", async () => {
    const transport = new MockCapTransport();
    const slow: ServiceHandler = {
      name: "slow",
      handle: async () => {
        // the order is refunded/rejected out from under us mid-work
        await transport.rejectOrder("order-2", "expired & refunded mid-work");
        return { ok: true };
      },
    };
    const { loop } = makeLoop({
      transport,
      services: { "svc-slow": slow },
      retries: 3,
    });
    await loop.start();
    transport.createNegotiation({ serviceId: "svc-slow" });
    await settle();
    transport.payOrder("order-2");
    await settle();

    expect(transport.deliveries.size).toBe(0);
    expect(loop.stats.ordersDelivered).toBe(0);
    expect(loop.stats.errors).toBe(0); // terminal state is not an error
  });

  it("kill -9 mid-order: a restarted worker delivers the paid order exactly once", async () => {
    const transport = new MockCapTransport();
    const { loop } = makeLoop({ transport });
    await loop.start();
    transport.createNegotiation({ serviceId: "svc-echo" });
    await settle();
    // worker is killed BEFORE the payment arrives
    loop.stop();
    transport.payOrder("order-2"); // event fires into the void (no listener)
    await settle();
    expect(transport.deliveries.size).toBe(0); // nothing delivered while down

    // restart: startup sweep recovers the queued paid order
    const { loop: restarted } = makeLoop({ transport });
    await restarted.start();
    await settle();

    expect(transport.deliveries.size).toBe(1);
    expect(restarted.stats.ordersDelivered).toBe(1);
  });
});
