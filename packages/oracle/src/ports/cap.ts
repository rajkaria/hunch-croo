/**
 * CAP (CROO Agent Protocol) transport port — the domain-shaped contract the
 * core provider loop depends on. The real adapter wraps `@croo-network/sdk`;
 * the mock adapter is deterministic and credential-free (the whole test suite
 * runs against it). Core never imports the SDK.
 */

export type CapEventType =
  | "negotiation_created"
  | "negotiation_rejected"
  | "negotiation_expired"
  | "order_created"
  | "order_paid"
  | "order_completed"
  | "order_rejected"
  | "order_expired";

export interface CapEvent {
  type: CapEventType;
  negotiationId?: string;
  orderId?: string;
  serviceId?: string;
  raw: Record<string, unknown>;
}

export interface CapNegotiation {
  negotiationId: string;
  serviceId: string;
  requirements: string;
  status: string;
  expiresAt?: string;
  /** Populated only for fund-transfer services (require_fund_transfer=true). */
  fundAmount?: string;
  fundToken?: string;
}

export interface CapOrder {
  orderId: string;
  negotiationId: string;
  serviceId: string;
  requesterAgentId: string;
  /** Decimal USDC price string. EMPTY on the live API — the value lives in
   * `amount` instead. Never read this directly for a money decision; go through
   * `policy.orderPriceUsd`, which falls back to `amount`. */
  price: string;
  /** Order value in `paymentToken` base units (decimal string), e.g.
   * "100000.00000000" = $0.10 for 6-decimal USDC. The live CAP API populates
   * THIS and leaves `price` empty; the mock populates `price`. A field the
   * SDK's own `Order` type does not declare. See docs/context/hosting-deploy.md. */
  amount?: string;
  paymentToken: string;
  status: string;
  payTxHash?: string;
  clearTxHash?: string;
  slaDeadline?: string;
}

export interface CapDeliverable {
  type: "text" | "schema";
  text?: string;
  schema?: string;
}

export interface CapConnection {
  close(): void;
}

/** Provider-side transport: listen, accept/reject, deliver. */
export interface CapProviderTransport {
  connect(onEvent: (event: CapEvent) => void): Promise<CapConnection>;
  getNegotiation(negotiationId: string): Promise<CapNegotiation>;
  acceptNegotiation(negotiationId: string): Promise<{ orderId: string }>;
  rejectNegotiation(negotiationId: string, reason: string): Promise<void>;
  getOrder(orderId: string): Promise<CapOrder>;
  /** Orders already paid (e.g. while the worker was offline). */
  listPaidOrders(): Promise<CapOrder[]>;
  /** Negotiations still pending a response. */
  listPendingNegotiations(): Promise<CapNegotiation[]>;
  deliverOrder(
    orderId: string,
    deliverable: CapDeliverable,
  ): Promise<{ txHash?: string }>;
  rejectOrder(orderId: string, reason: string): Promise<void>;
}

/** Requester-side transport (the spike script + the signal-buyer). */
export interface CapRequesterTransport {
  connect(onEvent: (event: CapEvent) => void): Promise<CapConnection>;
  negotiateOrder(req: {
    serviceId: string;
    requirements?: string;
  }): Promise<{ negotiationId: string }>;
  /** Read the order the counterparty created — carries the REAL negotiated
   * price, which the signal-buyer's pay-gate checks against its budget before
   * a single dollar of escrow moves. */
  getOrder(orderId: string): Promise<CapOrder>;
  payOrder(orderId: string): Promise<{ txHash: string }>;
  /** Decline a created-but-unpaid order (over budget / policy) — no escrow,
   * no money moved. Mirrors the provider's rejectOrder. */
  rejectOrder(orderId: string, reason: string): Promise<void>;
  getDelivery(orderId: string): Promise<{ text?: string; schema?: string }>;
}
