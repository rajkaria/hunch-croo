import type { ServiceContext, ServiceHandler } from "../service-registry.js";

/**
 * S0 spike service: proves the full CAP lifecycle (negotiate → escrow →
 * deliver → clear) with a deterministic deliverable. Replaced as the fallback
 * by real services (forecast/verify/spawn/…) from S1 on.
 */
export const echoService: ServiceHandler = {
  name: "echo",
  async handle(ctx: ServiceContext): Promise<Record<string, unknown>> {
    return {
      service: "echo",
      agent: "hunch-oracle",
      echoed: ctx.input ?? ctx.requirements,
      orderId: ctx.order.orderId,
      priceUsdc: ctx.order.price,
      asOf: ctx.clock.now().toISOString(),
      note: "Hunch Oracle Desk — CAP integration spike. Real services: forecast, sentiment, research, verify, spawn.",
      homepage: "https://www.playhunch.xyz/agents",
    };
  },
};
