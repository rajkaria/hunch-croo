import { HunchClient } from "../adapters/hunch/client.js";
import { createForecastService } from "../core/services/forecast.js";
import { readEnv } from "../config.js";
import { systemClock } from "../ports/runtime.js";
import type { CapOrder } from "../ports/cap.js";

/**
 * S1 exit gate: run canned questions through the real forecast handler against
 * LIVE playhunch.xyz data. Prints one line per question; exits non-zero if any
 * question errors (no_market is a valid answer, not an error).
 */
const QUESTIONS: Array<{ question: string; token?: string }> = [
  { question: "Will $AIXBT reach $50M market cap by July 15?" },
  { question: "Will $CARDS reach $100M market cap?" },
  { question: "Will $ANSEM flip $PUMP?" },
  { question: "Will $HUNCH flip $aeon before July 30?" },
  { question: "Which market-cap band will $BTC close in this week?" },
  { question: "Will $BTC be UP at the end of this hour?" },
  { question: "$DOGE up or down this hour?" },
  { question: "How high will $SOL peak this week?" },
  { question: "Will bitcoin be up this hour?" },
  { question: "Will Base reach 5,000 TPS by December 31, 2026?" },
  { question: "Will Base's total stablecoin market cap reach $10B?" },
  { question: "Will Base have higher 7-day DEX volume than Solana?" },
  { question: "Will Base officially launch a token by December 31, 2026?" },
  { question: "Will Arbitrum's DeFi TVL reach $2B by July 31?" },
  { question: "Will $HYPE become a top-5 cryptocurrency by market cap?" },
  { question: "Will Bankr beat pump.fun on daily launchpad volume on at least 3 days?" },
  { question: "Will $ANSEM close green on all 7 daily candles from July 4-10?" },
  { question: "Will $NEST reach a $10M market cap?" },
  { question: "Will it rain in Tokyo tomorrow?" },
  { question: "Will $NONEXISTENTCOIN reach $5M market cap in 30 days?" },
];

async function main() {
  const env = readEnv();
  const hunch = new HunchClient({ baseUrl: env.HUNCH_API_URL });
  const service = createForecastService(hunch);
  const order: CapOrder = {
    orderId: "smoke",
    negotiationId: "smoke",
    serviceId: "smoke",
    requesterAgentId: "smoke",
    price: "0.25",
    paymentToken: "USDC",
    status: "paid",
  };

  let failures = 0;
  for (const input of QUESTIONS) {
    try {
      const payload = await service.handle({
        order,
        requirements: "",
        input,
        clock: systemClock,
      });
      if (payload.status === "ok") {
        console.log(
          `OK        p=${String(payload.probability).padEnd(5)} conf=${String(payload.confidence).padEnd(10)} pool=$${String(payload.poolUsd).padEnd(8)} ${payload.marketId}  ← "${input.question}"`,
        );
      } else {
        console.log(
          `NO_MARKET searched=${payload.openMarketsSearched} best=${payload.bestScore}  ← "${input.question}"`,
        );
      }
    } catch (error) {
      failures += 1;
      console.error(`ERROR     ${String(error)}  ← "${input.question}"`);
    }
  }
  console.log(`\n${QUESTIONS.length - failures}/${QUESTIONS.length} answered without error`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error("fatal", error);
  process.exit(1);
});
