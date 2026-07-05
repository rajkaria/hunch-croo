import type { CapOrder } from "../ports/cap.js";
import type { Clock } from "../ports/runtime.js";

/**
 * A service handler turns a paid order into a deliverable payload (plain
 * object; the loop serializes it with stable-json). Handlers must be
 * deterministic given (order, parsed requirements, clock) — no hidden state.
 */
export interface ServiceContext {
  order: CapOrder;
  /** Raw requirements string from the negotiation. */
  requirements: string;
  /** JSON.parse(requirements) when valid JSON, else null. */
  input: unknown;
  clock: Clock;
}

export interface ServiceHandler {
  readonly name: string;
  handle(ctx: ServiceContext): Promise<Record<string, unknown>>;
}

export interface ServiceRegistry {
  /** Resolve a CAP serviceId to a handler, or null (→ negotiation rejected). */
  resolve(serviceId: string): ServiceHandler | null;
}

/**
 * Explicit map from CAP service ids (from the Store dashboard) to handlers.
 * `fallback` (used by the S0 spike) answers for ANY unmapped service id —
 * never enable it once real services are listed.
 */
export function createRegistry(options: {
  services?: Record<string, ServiceHandler>;
  fallback?: ServiceHandler;
}): ServiceRegistry {
  const services = options.services ?? {};
  return {
    resolve(serviceId: string): ServiceHandler | null {
      return services[serviceId] ?? options.fallback ?? null;
    },
  };
}
