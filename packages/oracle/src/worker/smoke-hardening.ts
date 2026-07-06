import type { AddressInfo } from "node:net";
import { MockCapTransport } from "../adapters/mock/transport.js";
import { ProviderLoop } from "../core/provider-loop.js";
import { createRegistry } from "../core/service-registry.js";
import { echoService } from "../core/services/echo.js";
import type { Clock, Sleeper } from "../ports/runtime.js";
import { startHealthServer } from "./health-server.js";

/**
 * Credential-free hardening demo — no keys, no network. Runs the desk through
 * the failure modes S10 must survive and asserts the money-path invariants hold:
 *  - kill -9 mid-order → restarted worker delivers exactly once (no double, no
 *    stuck escrow)
 *  - transient deliver blip → bounded retry recovers, delivers once
 *  - reconnect-storm duplicate events → accepted/delivered exactly once
 *  - SLA already expired → skipped (CAP refunds), never delivered stale
 * then boots the /status page and curls it.
 *
 *   pnpm --filter @hunch/oracle smoke:hardening
 */
const instantSleeper: Sleeper = { sleep: async () => {} };
const fixedClock: Clock = { now: () => new Date("2026-07-06T00:00:00.000Z") };
const silent = { info() {}, warn() {}, error() {} };

const ok = (b: boolean) => (b ? "✅" : "❌");
let failures = 0;
function check(label: string, pass: boolean) {
  if (!pass) failures += 1;
  console.log(`  ${ok(pass)} ${label}`);
}

async function settle() {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 10));
}

function newLoop(transport: MockCapTransport, clock: Clock = fixedClock) {
  return new ProviderLoop({
    transport,
    registry: createRegistry({ services: { "svc-echo": echoService } }),
    clock,
    logger: silent,
    sleeper: instantSleeper,
    deliverRetries: 3,
  });
}

async function main() {
  console.log("\n🧨 Hunch Oracle Desk — hardening smoke (credential-free)\n");

  // ── kill -9 mid-order ─────────────────────────────────────────────────────
  {
    console.log("kill -9 mid-order → restart recovers exactly once:");
    const t = new MockCapTransport();
    const loop = newLoop(t);
    await loop.start();
    t.createNegotiation({ serviceId: "svc-echo", requirements: '{"q":"up?"}' });
    await settle();
    loop.stop(); // worker killed
    t.payOrder("order-2"); // payment lands into the void (no listener)
    await settle();
    check("nothing delivered while the worker is down", t.deliveries.size === 0);

    const restarted = newLoop(t);
    await restarted.start(); // startup sweep recovers the paid order
    await settle();
    check("restarted worker delivered it once", t.deliveries.size === 1);
    check("no double delivery", t.deliverAttempts === 1);
  }

  // ── transient deliver blip ────────────────────────────────────────────────
  {
    console.log("\ntransient deliver failure → bounded retry recovers:");
    const t = new MockCapTransport();
    const loop = newLoop(t);
    await loop.start();
    t.createNegotiation({ serviceId: "svc-echo" });
    await settle();
    t.failDelivers(2, "throw-before"); // two blips, then success
    t.payOrder("order-2");
    await settle();
    check("delivered exactly once after retries", t.deliveries.size === 1);
    check("only one real on-chain delivery", t.deliverAttempts === 1);
    check("counted as delivered, no error", loop.stats.ordersDelivered === 1 && loop.stats.errors === 0);
  }

  // ── reconnect storm ───────────────────────────────────────────────────────
  {
    console.log("\nWS reconnect storm (duplicate events) → exactly once:");
    const t = new MockCapTransport();
    const loop = newLoop(t);
    await loop.start();
    const neg = t.createNegotiation({ serviceId: "svc-echo" });
    t.replayNegotiationCreated(neg.negotiationId);
    t.replayNegotiationCreated(neg.negotiationId);
    await settle();
    t.payOrder("order-2");
    t.replayPaid("order-2");
    t.replayPaid("order-2");
    await settle();
    check("accepted exactly once", loop.stats.negotiationsAccepted === 1);
    check("delivered exactly once", loop.stats.ordersDelivered === 1);
    check("no errors from the storm", loop.stats.errors === 0);
  }

  // ── SLA already expired ───────────────────────────────────────────────────
  {
    console.log("\nSLA already expired → skipped (escrow refunds), never stale:");
    const t = new MockCapTransport();
    const loop = newLoop(t);
    await loop.start();
    t.createNegotiation({
      serviceId: "svc-echo",
      slaDeadline: "2026-07-05T23:00:00.000Z", // 1h before the fixed clock
    });
    await settle();
    t.payOrder("order-2");
    await settle();
    check("not delivered", t.deliveries.size === 0);
    check("recorded as SLA-skipped", loop.stats.ordersSkippedSla === 1);
  }

  // ── status page ───────────────────────────────────────────────────────────
  {
    console.log("\nstatus page (ORACLE_HEALTH_PORT):");
    const t = new MockCapTransport();
    const loop = newLoop(t);
    await loop.start();
    const server = startHealthServer(loop, 0, silent);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/status`);
    const body = (await res.json()) as { status: string; connected: boolean };
    check(`GET /status → ${res.status}`, res.status === 200);
    check(`status="${body.status}", connected=${body.connected}`, body.connected === true);
    await new Promise<void>((r) => server.close(() => r()));
  }

  console.log(
    failures === 0
      ? "\n🎉 all hardening invariants held — no double delivery, no stuck escrow.\n"
      : `\n💥 ${failures} invariant(s) violated\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("smoke failed:", error);
  process.exit(1);
});
