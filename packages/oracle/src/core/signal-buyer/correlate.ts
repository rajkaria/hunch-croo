/**
 * Scopes a requester-side purchase to exactly ONE order over the CAP event
 * stream, so replayed or foreign events can't drive it.
 *
 * WHY: the live CAP WS replays historical events when a requester (re)connects.
 * A driver that acts on "the first order_created / order_completed" it sees will
 * pay a stale order or false-"complete" on a replayed one — the bug that masked
 * the AlphaTrack hire mid-flight (see docs/context/hosting-deploy.md). The
 * correlator adopts a single order and then only recognises THAT order's events.
 *
 * Two modes:
 *  - `requireNegotiationMatch: false` (buyOnce): adopt the first `created` order.
 *    The mock emits our order synchronously inside `negotiateOrder`, before the
 *    negotiation id is known, so strict matching would deadlock the suite; the
 *    real defence for the buyer is terminal-event ownership below. When both the
 *    event's and our negotiation id ARE known, a mismatch is still rejected.
 *  - `requireNegotiationMatch: true` (spike:requester, real network): adopt
 *    NOTHING until our negotiation id is known, then only the order whose
 *    `order_created` carries that exact id — replayed history is always ignored.
 */
export interface CorrelatorOptions {
  requireNegotiationMatch: boolean;
}

export interface CorrelatableEvent {
  orderId?: string;
  negotiationId?: string;
}

export class PurchaseCorrelator {
  private orderId: string | undefined;
  private negotiationId: string | undefined;

  constructor(private readonly opts: CorrelatorOptions) {}

  /** Record the negotiation id we opened, once `negotiateOrder` returns it. */
  setNegotiation(negotiationId: string): void {
    this.negotiationId = negotiationId;
  }

  /**
   * Try to adopt our order from an `order_created` event. Returns true exactly
   * once — for the event judged to be ours. Every later or foreign created event
   * returns false.
   */
  adopt(event: CorrelatableEvent): boolean {
    if (this.orderId !== undefined || !event.orderId) return false;

    if (this.opts.requireNegotiationMatch) {
      // Strict: never adopt before we know our negotiation, and only the exact
      // match — a replayed created event (foreign/absent id) is ignored.
      if (this.negotiationId === undefined) return false;
      if (event.negotiationId !== this.negotiationId) return false;
    } else if (
      this.negotiationId !== undefined &&
      event.negotiationId !== undefined &&
      event.negotiationId !== this.negotiationId
    ) {
      // Graceful: reject a mismatch only when both ids are actually known.
      return false;
    }

    this.orderId = event.orderId;
    return true;
  }

  /** Does a terminal event (completed / rejected / expired) belong to our
   * adopted order? False before adoption, and for any other order id. */
  owns(event: CorrelatableEvent): boolean {
    return (
      this.orderId !== undefined &&
      !!event.orderId &&
      event.orderId === this.orderId
    );
  }

  get adoptedOrderId(): string | undefined {
    return this.orderId;
  }
}
