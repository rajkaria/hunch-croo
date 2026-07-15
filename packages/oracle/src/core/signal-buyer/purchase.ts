import type {
  CapEvent,
  CapOrder,
  CapRequesterTransport,
} from "../../ports/cap.js";
import type { Clock, OracleLogger } from "../../ports/runtime.js";
import { orderPriceUsd } from "./policy.js";
import { PurchaseCorrelator } from "./correlate.js";

/**
 * One requester-side purchase, driven as a promise over the CAP event stream:
 *
 *   negotiate → (counterparty accepts) order_created
 *             → read the REAL price → gate(order)
 *             → pay  (escrow on Base)   OR   reject (no money moved)
 *             → order_completed → getDelivery
 *
 * The pay decision happens at order_created against the counterparty's actual
 * quoted price — never an estimate. A gate that declines rejects the order, so
 * a `skipped` outcome is guaranteed to have moved zero dollars.
 *
 * Fail-soft: timeouts and protocol failures resolve to a terminal outcome; they
 * never throw and never fabricate a delivery.
 */
export type PayGate = (
  order: CapOrder,
) => { pay: true } | { pay: false; reason: string };

export interface BuyOutcome {
  status: "delivered" | "skipped" | "rejected" | "failed";
  orderId?: string;
  order?: CapOrder;
  payTxHash?: string;
  delivery?: { text?: string; schema?: string };
  reason?: string;
}

export interface BuyDeps {
  transport: CapRequesterTransport;
  clock: Clock;
  logger?: OracleLogger;
  /** Wall-clock ceiling for the whole lifecycle. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export async function buyOnce(
  deps: BuyDeps,
  req: { serviceId: string; requirements?: string; gate: PayGate },
): Promise<BuyOutcome> {
  const { transport, logger } = deps;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<BuyOutcome>((resolvePromise) => {
    let settled = false;
    let connection: { close(): void } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Scope this purchase to one order so replayed history on connect can't
    // drive it (see correlate.ts). buyOnce adopts the first created order; the
    // real guard for the buyer is terminal-event ownership below.
    const correlator = new PurchaseCorrelator({ requireNegotiationMatch: false });

    const finish = (outcome: BuyOutcome) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        connection?.close();
      } catch {
        // best-effort close
      }
      resolvePromise(outcome);
    };

    timer = setTimeout(
      () => finish({ status: "failed", reason: `timeout after ${timeoutMs}ms` }),
      timeoutMs,
    );
    // A pure fake timer (tests) has no unref; guard it.
    (timer as { unref?: () => void }).unref?.();

    const onEvent = async (event: CapEvent) => {
      try {
        if (event.type === "order_created" && event.orderId) {
          if (correlator.adoptedOrderId !== undefined) return; // already handling one
          const order = await transport.getOrder(event.orderId);
          // A replayed created event points at an order that has since gone
          // terminal — never gate or pay it.
          if (order.status !== "created") return;
          if (!correlator.adopt(event)) return; // foreign negotiation
          const decision = req.gate(order);
          if (!decision.pay) {
            await transport.rejectOrder(order.orderId, decision.reason);
            logger?.info("signal-buyer declined an order (no escrow)", {
              orderId: order.orderId,
              reason: decision.reason,
            });
            finish({
              status: "skipped",
              orderId: order.orderId,
              order,
              reason: decision.reason,
            });
            return;
          }
          const { txHash } = await transport.payOrder(order.orderId);
          logger?.info("signal-buyer paid (escrow on Base)", {
            orderId: order.orderId,
            // `order.price` is empty on the live API — log the real derived USD.
            priceUsd: orderPriceUsd(order),
            txHash,
          });
        }
        if (event.type === "order_completed" && event.orderId) {
          if (!correlator.owns(event)) return; // replayed / foreign order
          const [order, delivery] = await Promise.all([
            transport.getOrder(event.orderId),
            transport.getDelivery(event.orderId),
          ]);
          finish({
            status: "delivered",
            orderId: event.orderId,
            order,
            ...(order.payTxHash !== undefined
              ? { payTxHash: order.payTxHash }
              : {}),
            delivery,
          });
        }
        if (event.type === "order_rejected" || event.type === "order_expired") {
          if (!correlator.owns(event)) return; // replayed / foreign order
          finish({
            status: "rejected",
            ...(event.orderId !== undefined ? { orderId: event.orderId } : {}),
            reason: event.type,
          });
        }
        if (event.type === "negotiation_rejected") {
          finish({ status: "rejected", reason: "negotiation_rejected" });
        }
      } catch (error) {
        finish({
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    };

    void (async () => {
      try {
        connection = await transport.connect(onEvent);
        const { negotiationId } = await transport.negotiateOrder({
          serviceId: req.serviceId,
          ...(req.requirements !== undefined
            ? { requirements: req.requirements }
            : {}),
        });
        correlator.setNegotiation(negotiationId);
      } catch (error) {
        finish({
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });
}
