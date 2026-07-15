import { CrooCapTransport } from "../adapters/croo/transport.js";
import { readEnv } from "../config.js";
import { consoleLogger } from "../ports/runtime.js";
import { PurchaseCorrelator } from "../core/signal-buyer/correlate.js";

/**
 * S0 spike — requester side. Hires a service end-to-end:
 * negotiate → (provider accepts) → pay (CAPVault escrow, Base USDC) →
 * (provider delivers) → fetch deliverable.
 *
 * Usage:
 *   CROO_TARGET_SERVICE_ID=<serviceId> pnpm spike:requester
 *   (run from a SECOND agent's SDK key — an agent cannot hire itself)
 */
async function main() {
  const env = readEnv();
  const serviceId = process.env.CROO_TARGET_SERVICE_ID;
  if (!serviceId) throw new Error("set CROO_TARGET_SERVICE_ID");

  const logger = consoleLogger;
  const transport = new CrooCapTransport({
    apiUrl: env.CROO_API_URL,
    wsUrl: env.CROO_WS_URL,
    sdkKey: process.env.CROO_REQUESTER_SDK_KEY ?? env.CROO_SDK_KEY,
    logger,
  });

  // Scope this run to OUR order. The CAP WS replays historical events on
  // connect, so an uncorrelated handler false-"completes" on a stale order
  // (see docs/context/hosting-deploy.md). Strict mode ignores everything that
  // isn't the order our negotiation created.
  const correlator = new PurchaseCorrelator({ requireNegotiationMatch: true });

  const done = new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("spike timed out after 180s")),
      180_000,
    );

    void transport.connect(async (event) => {
      try {
        if (event.type === "order_created" && event.orderId) {
          if (!correlator.adopt(event)) return; // replayed / foreign order
          logger.info("order created — paying (escrow on Base)", {
            orderId: event.orderId,
          });
          const { txHash } = await transport.payOrder(event.orderId);
          logger.info("paid", { txHash });
        }
        if (event.type === "order_completed" && event.orderId) {
          if (!correlator.owns(event)) return; // replayed / foreign order
          const delivery = await transport.getDelivery(event.orderId);
          logger.info("deliverable received", { delivery });
          clearTimeout(timeout);
          resolvePromise();
        }
        if (event.type === "order_rejected" || event.type === "order_expired") {
          if (!correlator.owns(event)) return; // replayed / foreign order
          clearTimeout(timeout);
          reject(new Error(`order ended: ${event.type}`));
        }
      } catch (error) {
        clearTimeout(timeout);
        reject(error as Error);
      }
    });
  });

  const { negotiationId } = await transport.negotiateOrder({
    serviceId,
    requirements:
      process.env.CROO_SPIKE_REQUIREMENTS ??
      JSON.stringify({
        question: "spike: does the CAP lifecycle clear end-to-end?",
      }),
  });
  correlator.setNegotiation(negotiationId);
  consoleLogger.info("negotiation opened", { negotiationId, serviceId });

  await done;
  consoleLogger.info("spike complete — full CAP lifecycle cleared ✅");
  process.exit(0);
}

main().catch((error) => {
  console.error("[spike] failed", error);
  process.exit(1);
});
