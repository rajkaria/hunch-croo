import { describe, expect, it } from "vitest";
import { MockCapTransport } from "../src/adapters/mock/transport.js";
import { ProviderLoop } from "../src/core/provider-loop.js";
import { createRegistry } from "../src/core/service-registry.js";
import { echoService } from "../src/core/services/echo.js";
import type {
  CapEvent,
  CapEventType,
} from "../src/ports/cap.js";
import type { Clock, OracleLogger, Sleeper } from "../src/ports/runtime.js";

const silentLogger: OracleLogger = { info() {}, warn() {}, error() {} };
const fixedClock: Clock = { now: () => new Date("2026-07-06T00:00:00.000Z") };
const instantSleeper: Sleeper = { sleep: async () => {} };

/** Deterministic PRNG (mulberry32) so a failure always reproduces. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function settle() {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 10));
}

/** A grab-bag of hostile requirements strings the matcher/handler must survive. */
function nastyRequirements(rand: () => number): string {
  const pool = [
    "",
    "{",
    "}{",
    "not json at all",
    "null",
    "undefined",
    "[1,2,3",
    '{"a":',
    '{"question": "' + "x".repeat(5000) + '"}',
    '{"nested":{"deep":{"deeper":{"x":1}}}}',
    '{"emoji":"🔮💸🧨","unicode":"\\u0000"}',
    '{"__proto__":{"polluted":true}}',
    JSON.stringify({ question: "up or down?", n: rand() }),
    String(rand()),
    "true",
  ];
  return pool[Math.floor(rand() * pool.length)] ?? "";
}

function garbageEvent(rand: () => number): CapEvent {
  const types: (CapEventType | string)[] = [
    "order_paid",
    "negotiation_created",
    "order_rejected",
    "order_expired",
    "order_completed",
    "totally_unknown_type",
    "",
  ];
  const type = types[Math.floor(rand() * types.length)] ?? "order_paid";
  const ev: CapEvent = { type: type as CapEventType, raw: {} };
  if (rand() < 0.7) ev.orderId = `ghost-order-${Math.floor(rand() * 1000)}`;
  if (rand() < 0.5) ev.negotiationId = `ghost-neg-${Math.floor(rand() * 1000)}`;
  return ev;
}

async function fuzzRound(seed: number) {
  const rand = rng(seed);
  const transport = new MockCapTransport();
  const registry = createRegistry({ services: { "svc-echo": echoService } });
  const loop = new ProviderLoop({
    transport,
    registry,
    clock: fixedClock,
    logger: silentLogger,
    sleeper: instantSleeper,
    deliverRetries: 2,
  });
  await loop.start();

  let validNegotiations = 0;
  for (let i = 0; i < 300; i += 1) {
    if (rand() < 0.5) {
      // a legitimate order with (often) malformed requirements
      transport.createNegotiation({
        serviceId: "svc-echo",
        requirements: nastyRequirements(rand),
      });
      validNegotiations += 1;
    } else {
      // pure garbage aimed straight at the event handler
      transport.injectRawEvent(garbageEvent(rand));
    }
  }
  await settle();

  // every accepted order is now "created" — pay them all
  const created = transport.listCreatedOrders();
  for (const order of created) transport.payOrder(order.orderId);
  await settle();

  return { transport, loop, validNegotiations, created: created.length };
}

describe("S10 fuzz — provider loop survives hostile input", () => {
  for (const seed of [20260706, 1, 42, 999999, 0xdeadbeef]) {
    it(`seed ${seed}: no crash, no fabricated/double delivery, valid orders delivered once`, async () => {
      const { transport, loop, validNegotiations, created } =
        await fuzzRound(seed);

      // exactly the valid orders delivered — no ghosts, no doubles
      expect(created).toBe(validNegotiations);
      expect(transport.deliveries.size).toBe(validNegotiations);
      expect(loop.stats.ordersDelivered).toBe(validNegotiations);

      // every deliverable is well-formed JSON (honest echo, never fabricated)
      for (const deliverable of transport.deliveries.values()) {
        const parsed = JSON.parse(deliverable.text ?? "");
        expect(parsed.service).toBe("echo");
      }

      // the loop is still alive and answering after the storm
      expect(loop.health().status).toBe("ok");
    });
  }

  it("a __proto__ payload never pollutes the global prototype", async () => {
    await fuzzRound(20260706);
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
