import { CrooCapTransport } from "../adapters/croo/transport.js";
import { readEnv } from "../config.js";
import { consoleLogger } from "../ports/runtime.js";

/**
 * Ops probe: validates the SDK key and prints current provider-side state
 * (pending negotiations + paid orders). Read-only; safe to run anytime.
 *
 *   pnpm --filter @hunch/oracle probe
 */
async function main() {
  const env = readEnv();
  const transport = new CrooCapTransport({
    apiUrl: env.CROO_API_URL,
    wsUrl: env.CROO_WS_URL,
    sdkKey: env.CROO_SDK_KEY,
    logger: consoleLogger,
  });

  const negotiations = await transport.listPendingNegotiations();
  const orders = await transport.listPaidOrders();
  console.log("AUTH OK ✅");
  console.log("pending negotiations:", JSON.stringify(negotiations, null, 2));
  console.log("paid (undelivered) orders:", JSON.stringify(orders, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error("[probe] failed —", error);
  process.exit(1);
});
