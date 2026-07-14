import { CrooCapTransport } from "../adapters/croo/transport.js";
import { buyerBudgetFromEnv, parseAllowlist, readEnv } from "../config.js";
import { SignalBuyer } from "../core/signal-buyer/buyer.js";
import { InMemorySignalStore } from "../core/signal-buyer/ledger.js";
import { runBuyerLoop } from "../core/signal-buyer/loop.js";
import { consoleLogger, systemClock, systemSleeper } from "../ports/runtime.js";

/**
 * Long-lived signal-buyer — the requester side, run as a daemon. It runs a
 * capped hire round every SIGNAL_BUYER_ROUND_INTERVAL_MS, forever, on ONE
 * process so the in-memory daily-cap ledger holds across rounds (see
 * core/signal-buyer/loop.ts for why that matters).
 *
 *   pnpm --filter @hunch/oracle signal-buyer-loop          # dry-run loop
 *   SIGNAL_BUYER_ENABLED=true pnpm ... signal-buyer-loop   # live, capped spend
 *
 * This is the process the docker-compose `buyer` service runs — the thing that
 * turns the "hunch buyer" agent from an empty card into recurring, capped
 * orders/volume. Dry-run by default: it loops and logs what it WOULD hire,
 * moving no money, until you flip SIGNAL_BUYER_ENABLED=true — which also
 * requires a non-empty allowlist and a distinct CROO_REQUESTER_SDK_KEY (an
 * agent cannot hire itself). The single-shot variant is `signal-buyer.ts`.
 */
async function main() {
  const env = readEnv();
  const logger = consoleLogger;

  const allowlist = parseAllowlist(env.SIGNAL_BUYER_ALLOWLIST);
  const budget = buyerBudgetFromEnv(env);
  const live = env.SIGNAL_BUYER_ENABLED;

  if (live && allowlist.length === 0) {
    throw new Error(
      "SIGNAL_BUYER_ENABLED=true but SIGNAL_BUYER_ALLOWLIST is empty — refusing to run a live buyer with no human-curated counterparties",
    );
  }
  if (live && !env.CROO_REQUESTER_SDK_KEY) {
    throw new Error(
      "SIGNAL_BUYER_ENABLED=true but CROO_REQUESTER_SDK_KEY is unset — an agent cannot hire itself; set a distinct requester key",
    );
  }

  const requesterKey = env.CROO_REQUESTER_SDK_KEY ?? env.CROO_SDK_KEY;
  const transport = new CrooCapTransport({
    apiUrl: env.CROO_API_URL,
    wsUrl: env.CROO_WS_URL,
    sdkKey: requesterKey,
    logger,
  });

  const store = new InMemorySignalStore();
  const buyer = new SignalBuyer(
    { transport, store, clock: systemClock, logger },
    { allowlist, budget, live },
  );

  // Graceful shutdown: flip the flag; the loop finishes the round in flight and
  // exits before the next sleep. No escrow is held between rounds, so even a
  // hard SIGKILL mid-sleep is safe.
  let running = true;
  const stop = (signal: string) => {
    if (!running) return;
    running = false;
    logger.info(`signal-buyer-loop: ${signal} — finishing the round in flight`);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  logger.info(live ? "signal-buyer-loop: LIVE" : "signal-buyer-loop: dry run", {
    counterparties: allowlist.length,
    dailyCapUsd: budget.dailyCapUsd,
    maxPriceUsd: budget.maxPriceUsd,
    intervalMs: env.SIGNAL_BUYER_ROUND_INTERVAL_MS,
  });

  const rounds = await runBuyerLoop({
    runner: buyer,
    sleeper: systemSleeper,
    intervalMs: env.SIGNAL_BUYER_ROUND_INTERVAL_MS,
    shouldContinue: () => running,
    logger,
    onReport: (r) =>
      logger.info("signal-buyer round complete", {
        day: r.day,
        live: r.live,
        purchased: r.purchased,
        skipped: r.skipped,
        failed: r.failed,
        spentUsd: r.spentUsd,
      }),
  });

  logger.info("signal-buyer-loop stopped", { rounds });
  process.exit(0);
}

main().catch((error) => {
  console.error("[signal-buyer-loop] fatal —", error);
  process.exit(1);
});
