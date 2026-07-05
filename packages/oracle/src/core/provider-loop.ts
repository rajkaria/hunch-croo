import type {
  CapConnection,
  CapEvent,
  CapNegotiation,
  CapOrder,
  CapProviderTransport,
} from "../ports/cap.js";
import type { Clock, OracleLogger } from "../ports/runtime.js";
import type { ServiceRegistry } from "./service-registry.js";
import { stableStringify } from "./stable-json.js";

/**
 * The provider loop: the one piece of orchestration between CAP and our
 * services. Pure logic over injected ports — fully covered by mock-transport
 * tests before it ever touches mainnet.
 *
 * Invariants:
 * - Accept only negotiations whose serviceId resolves in the registry; reject
 *   everything else (including fund-transfer negotiations, which we do not
 *   support) so requesters are never silently left hanging.
 * - Deliver each paid order EXACTLY once per process (in-flight guard); a
 *   handler failure rejects the order so CAPVault refunds escrow — we never
 *   deliver fabricated output (fail-soft, never fake).
 * - Deliverables are stable-json serialized: redelivery reproduces identical
 *   bytes → identical on-chain content hash.
 * - On startup, sweep pending negotiations + paid orders so work queued while
 *   the worker was offline is not lost.
 */
export interface ProviderLoopDeps {
  transport: CapProviderTransport;
  registry: ServiceRegistry;
  clock: Clock;
  logger: OracleLogger;
}

export interface ProviderLoopStats {
  negotiationsAccepted: number;
  negotiationsRejected: number;
  ordersDelivered: number;
  ordersRejected: number;
  errors: number;
}

export class ProviderLoop {
  private readonly deps: ProviderLoopDeps;
  private readonly inFlight = new Set<string>();
  private readonly delivered = new Set<string>();
  private connection: CapConnection | null = null;

  readonly stats: ProviderLoopStats = {
    negotiationsAccepted: 0,
    negotiationsRejected: 0,
    ordersDelivered: 0,
    ordersRejected: 0,
    errors: 0,
  };

  constructor(deps: ProviderLoopDeps) {
    this.deps = deps;
  }

  async start(): Promise<void> {
    this.connection = await this.deps.transport.connect((event) => {
      void this.onEvent(event);
    });
    await this.sweep();
    this.deps.logger.info("provider loop started");
  }

  stop(): void {
    this.connection?.close();
    this.connection = null;
    this.deps.logger.info("provider loop stopped");
  }

  /** Catch up on anything that happened while offline. */
  async sweep(): Promise<void> {
    const { transport, logger } = this.deps;
    const pending = await transport.listPendingNegotiations();
    for (const negotiation of pending) {
      await this.handleNegotiation(negotiation);
    }
    const paid = await transport.listPaidOrders();
    for (const order of paid) {
      await this.fulfil(order.orderId);
    }
    if (pending.length || paid.length) {
      logger.info("sweep complete", {
        pendingNegotiations: pending.length,
        paidOrders: paid.length,
      });
    }
  }

  private async onEvent(event: CapEvent): Promise<void> {
    const { transport, logger } = this.deps;
    try {
      switch (event.type) {
        case "negotiation_created": {
          if (!event.negotiationId) return;
          const negotiation = await transport.getNegotiation(
            event.negotiationId,
          );
          await this.handleNegotiation(negotiation);
          return;
        }
        case "order_paid": {
          if (!event.orderId) return;
          await this.fulfil(event.orderId);
          return;
        }
        default:
          return;
      }
    } catch (error) {
      this.stats.errors += 1;
      logger.error("event handling failed", {
        type: event.type,
        error: String(error),
      });
    }
  }

  private async handleNegotiation(negotiation: CapNegotiation): Promise<void> {
    const { transport, registry, logger } = this.deps;
    if (negotiation.status && negotiation.status !== "pending") return;

    if (negotiation.fundAmount && negotiation.fundAmount !== "0") {
      await transport.rejectNegotiation(
        negotiation.negotiationId,
        "fund-transfer services are not supported by this agent",
      );
      this.stats.negotiationsRejected += 1;
      return;
    }

    const handler = registry.resolve(negotiation.serviceId);
    if (!handler) {
      await transport.rejectNegotiation(
        negotiation.negotiationId,
        `unknown service ${negotiation.serviceId}`,
      );
      this.stats.negotiationsRejected += 1;
      logger.warn("rejected negotiation for unknown service", {
        serviceId: negotiation.serviceId,
      });
      return;
    }

    const { orderId } = await transport.acceptNegotiation(
      negotiation.negotiationId,
    );
    this.stats.negotiationsAccepted += 1;
    logger.info("negotiation accepted", {
      negotiationId: negotiation.negotiationId,
      serviceId: negotiation.serviceId,
      handler: handler.name,
      orderId,
    });
  }

  private async fulfil(orderId: string): Promise<void> {
    const { transport, registry, clock, logger } = this.deps;
    if (this.delivered.has(orderId) || this.inFlight.has(orderId)) return;
    this.inFlight.add(orderId);
    try {
      const order = await transport.getOrder(orderId);
      if (order.status !== "paid") {
        logger.info("skipping order not in paid state", {
          orderId,
          status: order.status,
        });
        return;
      }

      const handler = registry.resolve(order.serviceId);
      if (!handler) {
        await transport.rejectOrder(
          orderId,
          `no handler for service ${order.serviceId}`,
        );
        this.stats.ordersRejected += 1;
        return;
      }

      const negotiation = await transport.getNegotiation(order.negotiationId);
      const requirements = negotiation.requirements ?? "";
      let input: unknown = null;
      try {
        input = requirements ? JSON.parse(requirements) : null;
      } catch {
        input = null;
      }

      let payload: Record<string, unknown>;
      try {
        payload = await handler.handle({ order, requirements, input, clock });
      } catch (error) {
        // Fail-soft, never fake: reject → CAPVault refunds the escrow.
        await transport.rejectOrder(
          orderId,
          `service ${handler.name} failed: ${String(error)}`,
        );
        this.stats.ordersRejected += 1;
        logger.error("handler failed; order rejected (escrow refunds)", {
          orderId,
          handler: handler.name,
          error: String(error),
        });
        return;
      }

      const { txHash } = await transport.deliverOrder(orderId, {
        type: "text",
        text: stableStringify(payload),
      });
      this.delivered.add(orderId);
      this.stats.ordersDelivered += 1;
      logger.info("order delivered", {
        orderId,
        handler: handler.name,
        txHash: txHash ?? null,
      });
    } finally {
      this.inFlight.delete(orderId);
    }
  }
}
