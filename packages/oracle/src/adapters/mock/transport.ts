import type {
  CapDeliverable,
  CapEvent,
  CapNegotiation,
  CapOrder,
  CapProviderTransport,
} from "../../ports/cap.js";

/** A deliver fault the chaos suite can script (see {@link MockCapTransport.failDelivers}).
 *  - "throw-before": fail without touching state (pure transient blip).
 *  - "throw-after":  apply the state change (order → completed on-chain) THEN
 *    throw — models the tx landing but the response being lost, so a restarted
 *    worker must NOT re-deliver. */
export type DeliverFault = "throw-before" | "throw-after";

/**
 * Deterministic, credential-free in-memory CAP — drives the whole test suite.
 * Test code scripts the requester side (createNegotiation / payOrder) and
 * asserts on provider behavior (accepted / rejected / delivered). The chaos
 * hooks (failDelivers, slaDeadline, replayPaid) let the hardening suite inject
 * the failure modes S10 must survive.
 */
export class MockCapTransport implements CapProviderTransport {
  private negotiations = new Map<string, CapNegotiation>();
  private orders = new Map<string, CapOrder>();
  readonly deliveries = new Map<string, CapDeliverable>();
  readonly rejectedNegotiations = new Map<string, string>();
  readonly rejectedOrders = new Map<string, string>();
  private listener: ((event: CapEvent) => void) | null = null;
  private seq = 0;
  /** SLA deadline to stamp onto the order minted from a given negotiation. */
  private slaByNegotiation = new Map<string, string>();
  /** Queue of deliver faults, consumed one per deliverOrder call. */
  private deliverFaults: DeliverFault[] = [];
  /** Count of deliverOrder calls that actually moved the order to completed. */
  deliverAttempts = 0;

  /** Chaos: the next `count` deliverOrder calls fail with `mode`. */
  failDelivers(count: number, mode: DeliverFault): void {
    for (let i = 0; i < count; i += 1) this.deliverFaults.push(mode);
  }

  /** Chaos: re-emit an order_paid for an order (WS reconnect / duplicate event). */
  replayPaid(orderId: string): void {
    this.emit({ type: "order_paid", orderId, raw: {} });
  }

  /** Fuzz: inject an arbitrary (possibly malformed) event straight at the loop. */
  injectRawEvent(event: CapEvent): void {
    this.emit(event);
  }

  /** Test helper: orders created but not yet paid. */
  listCreatedOrders(): CapOrder[] {
    return [...this.orders.values()].filter((o) => o.status === "created");
  }

  /** Chaos: re-emit a negotiation_created (WS reconnect / duplicate event). */
  replayNegotiationCreated(negotiationId: string): void {
    const negotiation = this.negotiations.get(negotiationId);
    if (!negotiation) throw new Error(`mock: unknown negotiation ${negotiationId}`);
    this.emit({
      type: "negotiation_created",
      negotiationId,
      serviceId: negotiation.serviceId,
      raw: {},
    });
  }

  async connect(onEvent: (event: CapEvent) => void) {
    this.listener = onEvent;
    return { close: () => (this.listener = null) };
  }

  private emit(event: CapEvent) {
    this.listener?.(event);
  }

  /** Test helper: a requester opens a negotiation. */
  createNegotiation(input: {
    serviceId: string;
    requirements?: string;
    fundAmount?: string;
    /** Chaos: SLA deadline stamped on the order this negotiation mints. */
    slaDeadline?: string;
  }): CapNegotiation {
    const negotiationId = `neg-${++this.seq}`;
    const negotiation: CapNegotiation = {
      negotiationId,
      serviceId: input.serviceId,
      requirements: input.requirements ?? "",
      status: "pending",
      ...(input.fundAmount !== undefined
        ? { fundAmount: input.fundAmount }
        : {}),
    };
    if (input.slaDeadline !== undefined)
      this.slaByNegotiation.set(negotiationId, input.slaDeadline);
    this.negotiations.set(negotiationId, negotiation);
    this.emit({
      type: "negotiation_created",
      negotiationId,
      serviceId: input.serviceId,
      raw: {},
    });
    return negotiation;
  }

  /** Test helper: the requester pays a created order. */
  payOrder(orderId: string): void {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`mock: unknown order ${orderId}`);
    if (order.status !== "created")
      throw new Error(`mock: pay in state ${order.status}`);
    order.status = "paid";
    order.payTxHash = `0xpay${orderId}`;
    this.emit({ type: "order_paid", orderId, raw: {} });
  }

  async getNegotiation(negotiationId: string): Promise<CapNegotiation> {
    const negotiation = this.negotiations.get(negotiationId);
    if (!negotiation) throw new Error(`mock: unknown negotiation`);
    return negotiation;
  }

  async acceptNegotiation(negotiationId: string): Promise<{ orderId: string }> {
    const negotiation = await this.getNegotiation(negotiationId);
    if (negotiation.status !== "pending")
      throw new Error(`mock: accept in state ${negotiation.status}`);
    negotiation.status = "accepted";
    const orderId = `order-${++this.seq}`;
    const sla = this.slaByNegotiation.get(negotiationId);
    this.orders.set(orderId, {
      orderId,
      negotiationId,
      serviceId: negotiation.serviceId,
      requesterAgentId: "mock-requester",
      price: "0.10",
      paymentToken: "USDC",
      status: "created",
      ...(sla !== undefined ? { slaDeadline: sla } : {}),
    });
    this.emit({ type: "order_created", orderId, raw: {} });
    return { orderId };
  }

  async rejectNegotiation(negotiationId: string, reason: string) {
    const negotiation = await this.getNegotiation(negotiationId);
    negotiation.status = "rejected";
    this.rejectedNegotiations.set(negotiationId, reason);
  }

  async getOrder(orderId: string): Promise<CapOrder> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`mock: unknown order ${orderId}`);
    return order;
  }

  async listPaidOrders(): Promise<CapOrder[]> {
    return [...this.orders.values()].filter((o) => o.status === "paid");
  }

  async listPendingNegotiations(): Promise<CapNegotiation[]> {
    return [...this.negotiations.values()].filter(
      (n) => n.status === "pending",
    );
  }

  async deliverOrder(orderId: string, deliverable: CapDeliverable) {
    const order = await this.getOrder(orderId);
    if (order.status !== "paid")
      throw new Error(`mock: deliver in state ${order.status}`);
    if (this.deliveries.has(orderId))
      throw new Error(`mock: duplicate delivery for ${orderId}`);
    const fault = this.deliverFaults.shift();
    if (fault === "throw-before")
      throw new Error(`mock: injected transient deliver failure for ${orderId}`);
    this.deliverAttempts += 1;
    order.status = "completed";
    order.clearTxHash = `0xclear${orderId}`;
    this.deliveries.set(orderId, deliverable);
    this.emit({ type: "order_completed", orderId, raw: {} });
    if (fault === "throw-after")
      throw new Error(`mock: deliver landed but response lost for ${orderId}`);
    return { txHash: order.clearTxHash };
  }

  async rejectOrder(orderId: string, reason: string) {
    const order = await this.getOrder(orderId);
    order.status = "rejected";
    this.rejectedOrders.set(orderId, reason);
    this.emit({ type: "order_rejected", orderId, raw: {} });
  }
}
