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
  price: string;
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

/** Requester-side transport (the spike script + the future signal-buyer). */
export interface CapRequesterTransport {
  connect(onEvent: (event: CapEvent) => void): Promise<CapConnection>;
  negotiateOrder(req: {
    serviceId: string;
    requirements?: string;
  }): Promise<{ negotiationId: string }>;
  payOrder(orderId: string): Promise<{ txHash: string }>;
  getDelivery(orderId: string): Promise<{ text?: string; schema?: string }>;
}
