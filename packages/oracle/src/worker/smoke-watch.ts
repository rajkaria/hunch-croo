import { HunchClient } from "../adapters/hunch/client.js";
import { createWatchService } from "../core/services/watch.js";
import { readEnv } from "../config.js";
import { systemClock, systemSleeper } from "../ports/runtime.js";
import type { CapOrder } from "../ports/cap.js";

/**
 * S5 exit gate: watch a LIVE recurring round to resolution. The $VIRTUAL
 * 5-minute up/down round resolves every 5 minutes, so a resolution watch on
 * the current round fires within ~10 minutes of real time.
 *
 * Usage: npx tsx src/worker/smoke-watch.ts [marketSlug]
 */
async function main() {
  const env = readEnv();
  const hunch = new HunchClient({ baseUrl: env.HUNCH_API_URL });

  let slug = process.argv[2];
  if (!slug) {
    // Find the live 5-minute round from discover.
    const discovered = await hunch.discover("$VIRTUAL up down 5 minute", 8);
    const round = discovered.data.matches.find((m) =>
      m.market.id.includes("up-down-5m"),
    );
    if (!round) throw new Error("no live 5m round discovered");
    slug = round.market.id;
  }
  console.log(`watching ${slug} for resolution…`);

  const order: CapOrder = {
    orderId: "smoke-watch",
    negotiationId: "smoke",
    serviceId: "smoke",
    requesterAgentId: "smoke",
    price: "0.50",
    paymentToken: "USDC",
    status: "paid",
    slaDeadline: new Date(Date.now() + 15 * 60_000).toISOString(),
  };

  const service = createWatchService({ hunch, sleeper: systemSleeper });
  const payload = await service.handle({
    order,
    requirements: "",
    input: { marketSlug: slug, trigger: { kind: "resolution" }, pollSeconds: 20 },
    clock: systemClock,
  });
  console.log(JSON.stringify(payload, null, 2));
  if (payload.status !== "triggered") process.exit(1);
}

main().catch((error) => {
  console.error("fatal", error);
  process.exit(1);
});
