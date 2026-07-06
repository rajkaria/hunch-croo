import { HunchClient } from "../adapters/hunch/client.js";
import { createForecastService } from "../core/services/forecast.js";
import { createSpawnService } from "../core/services/spawn.js";
import { createVerifyService } from "../core/services/verify.js";
import { readEnv } from "../config.js";
import { systemClock } from "../ports/runtime.js";
import type { CapOrder } from "../ports/cap.js";

/**
 * S4 exit gate — the §11 demo beat, live against prod:
 *   1. forecast a question with NO market → no_market + spawnHint
 *   2. spawn → a REAL market appears on playhunch.xyz
 *   3. re-run the forecast → it now matches the spawned market
 * Plus a live + a point-in-time verify through the TruthCheck bridge.
 *
 * Usage: npx tsx src/worker/smoke-flywheel.ts [TOKEN] [MULTIPLIER] [DAYS]
 */
const order: CapOrder = {
  orderId: "smoke-flywheel",
  negotiationId: "smoke",
  serviceId: "smoke",
  requesterAgentId: "smoke",
  price: "2.50",
  paymentToken: "USDC",
  status: "paid",
};

async function main() {
  const env = readEnv();
  const hunch = new HunchClient({ baseUrl: env.HUNCH_API_URL });
  const forecast = createForecastService(hunch);
  const spawn = createSpawnService(hunch);
  const verify = createVerifyService(hunch);

  const token = (process.argv[2] ?? "VIRTUAL").toUpperCase();
  const multiplier = Number(process.argv[3] ?? 2);
  const horizonDays = Number(process.argv[4] ?? 30);
  const question = `Will $${token} ${multiplier}x its market cap within ${horizonDays} days?`;

  console.log(`\n[1] forecast: "${question}"`);
  const before = await forecast.handle({
    order,
    requirements: "",
    input: { question, token },
    clock: systemClock,
  });
  console.log(
    `    → ${before.status}` +
      (before.status === "ok"
        ? ` p=${before.probability} market=${before.marketId}`
        : ` (spawnHint: ${JSON.stringify((before.spawnHint as { input: unknown }).input)})`),
  );

  console.log(`\n[2] spawn: {token: ${token}, multiplier: ${multiplier}, horizonDays: ${horizonDays}}`);
  const spawned = await spawn.handle({
    order,
    requirements: "",
    input: { token, multiplier, horizonDays },
    clock: systemClock,
  });
  console.log(`    → ${spawned.status}: ${spawned.marketUrl}`);
  console.log(`    question: ${spawned.question}`);
  console.log(`    seededOdds: ${JSON.stringify(spawned.seededOdds)}`);

  console.log(`\n[3] forecast again (same question)`);
  const after = await forecast.handle({
    order,
    requirements: "",
    input: { question, token },
    clock: systemClock,
  });
  console.log(
    `    → ${after.status}` +
      (after.status === "ok"
        ? ` p=${after.probability} conf=${after.confidence} market=${after.marketId}`
        : ""),
  );

  console.log(`\n[4] verify (live): AIXBT mcap ≥ $10M`);
  const live = await verify.handle({
    order,
    requirements: "",
    input: { family: "mcap_at_least", token: "AIXBT", lineUsd: 10_000_000 },
    clock: systemClock,
  });
  console.log(`    → verdict=${live.verdict}`);

  console.log(`\n[5] verify (point-in-time): BTC price ≥ $100k on 2026-07-01`);
  const historical = await verify.handle({
    order,
    requirements: "",
    input: { family: "price_at_least", token: "BTC", lineUsd: 100_000, onDay: "2026-07-01" },
    clock: systemClock,
  });
  console.log(
    `    → verdict=${historical.verdict}${historical.reason ? ` (${historical.reason})` : ""}`,
  );
  const reading = historical.reading as Record<string, unknown> | null;
  if (reading) console.log(`    reading: ${JSON.stringify(reading)}`);

  // Success = the spawned market is live AND the forecast now resolves the
  // question to exactly that market. (On re-runs the factory is idempotent, so
  // step [1] may already find it — that IS the flywheel having worked.)
  const flywheelWorked =
    (spawned.status === "live" || spawned.status === "already_live") &&
    after.status === "ok" &&
    after.marketId === spawned.marketId;
  console.log(`\nFLYWHEEL ${flywheelWorked ? "✓ COMPLETE" : "✗ INCOMPLETE"}`);
  if (!flywheelWorked) process.exit(1);
}

main().catch((error) => {
  console.error("fatal", error);
  process.exit(1);
});
