import type {
  CapConnection,
  CapEvent,
  CapNegotiation,
  CapOrder,
  CapProviderTransport,
} from "../ports/cap.js";
import type { LedgerStore } from "../ports/ledger.js";
import type { Clock, OracleLogger, Sleeper } from "../ports/runtime.js";
import { systemSleeper } from "../ports/runtime.js";
import type { ServiceRegistry } from "./service-registry.js";
import { retry } from "./retry.js";
import { stableStringify } from "./stable-json.js";
import { extractForecastRecord } from "./track-record/record-from-forecast.js";

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
  /** Backoff sleeper for transient-failure retries (default: real timers). */
  sleeper?: Sleeper;
  /** How many times to retry a transient deliver failure (default: 3). */
  deliverRetries?: number;
  /** Base backoff (ms) for deliver retries (default: 250). */
  retryBaseMs?: number;
  /**
   * Optional track-record ledger. When set, each successfully delivered
   * `forecast` is recorded for later scoring. Recording is ADVISORY: a ledger
   * failure never fails a paid delivery (the money already moved), so the money
   * path stays clean.
   */
  ledger?: LedgerStore;
}

export interface ProviderLoopStats {
  negotiationsAccepted: number;
  negotiationsRejected: number;
  ordersDelivered: number;
  ordersRejected: number;
  /** Paid orders skipped because their SLA deadline had already passed. */
  ordersSkippedSla: number;
  errors: number;
  /**
   * Delivered orders broken down by service handler name (S12 observability).
   * Powers the per-service throughput + booked-revenue metrics. Additive: the
   * scalar counters above are unchanged.
   */
  deliveredByService: Record<string, number>;
}

/** A point-in-time liveness snapshot — the payload behind the status page. */
export interface ProviderLoopHealth {
  status: "starting" | "ok" | "stopped";
  connected: boolean;
  startedAt: string | null;
  lastEventAt: string | null;
  lastSweepAt: string | null;
  uptimeSeconds: number;
  stats: ProviderLoopStats;
}

export class ProviderLoop {
  private readonly deps: ProviderLoopDeps;
  private readonly sleeper: Sleeper;
  private readonly deliverRetries: number;
  private readonly retryBaseMs: number;
  private readonly inFlight = new Set<string>();
  private readonly delivered = new Set<string>();
  /** Orders already written to the track record this process (dedup guard). */
  private readonly recorded = new Set<string>();
  private readonly negotiationsInFlight = new Set<string>();
  private readonly acceptedNegotiations = new Set<string>();
  private connection: CapConnection | null = null;
  private startedAt: Date | null = null;
  private stopped = false;
  private lastEventAt: Date | null = null;
  private lastSweepAt: Date | null = null;

  readonly stats: ProviderLoopStats = {
    negotiationsAccepted: 0,
    negotiationsRejected: 0,
    ordersDelivered: 0,
    ordersRejected: 0,
    ordersSkippedSla: 0,
    errors: 0,
    deliveredByService: {},
  };

  constructor(deps: ProviderLoopDeps) {
    this.deps = deps;
    this.sleeper = deps.sleeper ?? systemSleeper;
    this.deliverRetries = deps.deliverRetries ?? 3;
    this.retryBaseMs = deps.retryBaseMs ?? 250;
  }

  /** True if the order's SLA deadline is set and already in the past. */
  private slaExpired(order: CapOrder): boolean {
    if (!order.slaDeadline) return false;
    return this.deps.clock.now().getTime() > new Date(order.slaDeadline).getTime();
  }

  async start(): Promise<void> {
    this.startedAt = this.deps.clock.now();
    this.stopped = false;
    this.connection = await this.deps.transport.connect((event) => {
      void this.onEvent(event);
    });
    await this.sweep();
    this.deps.logger.info("provider loop started");
  }

  stop(): void {
    this.connection?.close();
    this.connection = null;
    this.stopped = true;
    this.deps.logger.info("provider loop stopped");
  }

  /** Point-in-time liveness snapshot for the status page / health probe. */
  health(): ProviderLoopHealth {
    const now = this.deps.clock.now();
    return {
      status: this.stopped ? "stopped" : this.startedAt ? "ok" : "starting",
      connected: this.connection !== null,
      startedAt: this.startedAt?.toISOString() ?? null,
      lastEventAt: this.lastEventAt?.toISOString() ?? null,
      lastSweepAt: this.lastSweepAt?.toISOString() ?? null,
      uptimeSeconds: this.startedAt
        ? Math.floor((now.getTime() - this.startedAt.getTime()) / 1000)
        : 0,
      stats: { ...this.stats },
    };
  }

  /** Catch up on anything that happened while offline. */
  async sweep(): Promise<void> {
    const { transport, logger } = this.deps;
    this.lastSweepAt = this.deps.clock.now();
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
    this.lastEventAt = this.deps.clock.now();
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

    // Reconnect-storm guard: duplicate negotiation_created events race here with
    // identical `pending` reads. The synchronous in-flight/accepted check (no
    // await before it) admits exactly one, so we never fire a second accept.
    const negId = negotiation.negotiationId;
    if (this.negotiationsInFlight.has(negId) || this.acceptedNegotiations.has(negId))
      return;
    this.negotiationsInFlight.add(negId);
    try {
      if (negotiation.fundAmount && negotiation.fundAmount !== "0") {
        await transport.rejectNegotiation(
          negId,
          "fund-transfer services are not supported by this agent",
        );
        this.stats.negotiationsRejected += 1;
        return;
      }

      const handler = registry.resolve(negotiation.serviceId);
      if (!handler) {
        await transport.rejectNegotiation(
          negId,
          `unknown service ${negotiation.serviceId}`,
        );
        this.stats.negotiationsRejected += 1;
        logger.warn("rejected negotiation for unknown service", {
          serviceId: negotiation.serviceId,
        });
        return;
      }

      const { orderId } = await transport.acceptNegotiation(negId);
      this.acceptedNegotiations.add(negId);
      this.stats.negotiationsAccepted += 1;
      logger.info("negotiation accepted", {
        negotiationId: negId,
        serviceId: negotiation.serviceId,
        handler: handler.name,
        orderId,
      });
    } finally {
      this.negotiationsInFlight.delete(negId);
    }
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

      // SLA already blown before we even start: don't burn an upstream call and
      // don't deliver stale — CAP's expiry path refunds the escrow.
      if (this.slaExpired(order)) {
        this.stats.ordersSkippedSla += 1;
        logger.warn("skipping order past SLA deadline", {
          orderId,
          slaDeadline: order.slaDeadline,
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

      const text = stableStringify(payload);
      // A single, state-checked, retryable delivery. Re-reading the order each
      // attempt makes it idempotent and self-healing:
      //  - transient blip (deliver threw, state untouched) → retry re-delivers.
      //  - landed-but-lost (tx cleared, response dropped) → next read shows the
      //    order already completed, so we count it once instead of re-sending.
      //  - SLA blown while the handler ran → skip; CAP's expiry refunds escrow.
      type Outcome =
        | { kind: "delivered"; txHash: string | undefined }
        | { kind: "already" }
        | { kind: "sla" }
        | { kind: "gone"; status: string };
      const attempt = async (): Promise<Outcome> => {
        const current = await transport.getOrder(orderId);
        if (current.status === "completed") return { kind: "already" };
        // Terminal non-paid state (rejected/expired/refunded, possibly mid-work):
        // stop cleanly — not an error, and don't burn the retry budget on it.
        if (current.status !== "paid")
          return { kind: "gone", status: current.status };
        if (this.slaExpired(current)) return { kind: "sla" };
        const { txHash } = await transport.deliverOrder(orderId, {
          type: "text",
          text,
        });
        return { kind: "delivered", txHash };
      };

      let outcome: Outcome;
      try {
        outcome = await retry(attempt, {
          retries: this.deliverRetries,
          baseMs: this.retryBaseMs,
          sleeper: this.sleeper,
          onRetry: (n, error) =>
            logger.warn("deliver failed; retrying", {
              orderId,
              attempt: n,
              error: String(error),
            }),
        });
      } catch (deliverError) {
        // The deliver may actually have LANDED and only the response was lost.
        // Re-read the truth: completed → count once (no double send); still paid
        // → a genuine failure, propagate so escrow is untouched and the periodic
        // sweep retries later (no stuck escrow).
        const after = await transport.getOrder(orderId);
        if (after.status !== "completed") throw deliverError;
        outcome = { kind: "already" };
      }

      if (outcome.kind === "sla") {
        this.stats.ordersSkippedSla += 1;
        logger.warn("SLA expired mid-work; not delivering", { orderId });
        return;
      }
      if (outcome.kind === "gone") {
        logger.info("order left the paid state before delivery; nothing to do", {
          orderId,
          status: outcome.status,
        });
        return;
      }
      this.delivered.add(orderId);
      this.stats.ordersDelivered += 1;
      this.stats.deliveredByService[handler.name] =
        (this.stats.deliveredByService[handler.name] ?? 0) + 1;
      const txHash =
        outcome.kind === "delivered" ? (outcome.txHash ?? null) : null;
      logger.info(
        outcome.kind === "already"
          ? "order already completed on-chain (response was lost); counted once"
          : "order delivered",
        { orderId, handler: handler.name, txHash },
      );
      // Advisory track record — after the delivery is confirmed, never before.
      await this.record(order, payload, txHash);
    } finally {
      this.inFlight.delete(orderId);
    }
  }

  /**
   * Record a delivered forecast to the track record. Best-effort and strictly
   * advisory: only forecasts are recorded, each order at most once per process,
   * and any ledger error is logged and swallowed so it can NEVER fail a paid
   * delivery. Cross-restart duplicates are harmless — the scorecard dedups by
   * order to the latest entry.
   */
  private async record(
    order: CapOrder,
    payload: Record<string, unknown>,
    txHash: string | null,
  ): Promise<void> {
    const { ledger, clock, logger } = this.deps;
    if (!ledger || this.recorded.has(order.orderId)) return;
    let draft;
    try {
      draft = extractForecastRecord(payload, order, txHash, clock);
    } catch {
      draft = null;
    }
    if (!draft) return;
    try {
      await ledger.append(draft);
      this.recorded.add(order.orderId);
      logger.info("forecast recorded to track record", {
        orderId: order.orderId,
        marketId: draft.marketId,
      });
    } catch (error) {
      logger.warn("track-record append failed (delivery unaffected)", {
        orderId: order.orderId,
        error: String(error),
      });
    }
  }
}
