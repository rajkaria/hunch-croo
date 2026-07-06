import { CrooCapTransport } from "../adapters/croo/transport.js";
import { buyerBudgetFromEnv, parseAllowlist, readEnv } from "../config.js";
import { SignalBuyer } from "../core/signal-buyer/buyer.js";
import { InMemorySignalStore } from "../core/signal-buyer/ledger.js";
import { stableStringify } from "../core/stable-json.js";
import { consoleLogger, systemClock } from "../ports/runtime.js";

/**
 * S8 — the bidirectional story. The desk stops being only a seller: it hires
 * external CAP research agents, folds their (advisory) signals into its own
 * decisions, and seeds their counterparty counts on the way.
 *
 *   pnpm --filter @hunch/oracle signal-buyer        # dry run (default)
 *   SIGNAL_BUYER_ENABLED=true pnpm ... signal-buyer  # real, capped spend
 *
 * Requires CROO_REQUESTER_SDK_KEY (a distinct agent — one cannot hire itself)
 * and a non-empty SIGNAL_BUYER_ALLOWLIST when live.
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

  logger.info(live ? "signal-buyer: LIVE round" : "signal-buyer: dry run", {
    counterparties: allowlist.length,
    dailyCapUsd: budget.dailyCapUsd,
    maxPriceUsd: budget.maxPriceUsd,
  });

  const report = await buyer.runRound();
  console.log(stableStringify(report));
  logger.info("signal-buyer round complete", {
    purchased: report.purchased,
    skipped: report.skipped,
    failed: report.failed,
    spentUsd: report.spentUsd,
  });
  process.exit(0);
}

main().catch((error) => {
  console.error("[signal-buyer] failed —", error);
  process.exit(1);
});
