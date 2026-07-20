import { describe, expect, it } from "vitest";
import { MockHunchApi } from "../src/adapters/mock/hunch.js";
import { matchQuestion, openMarkets } from "../src/core/forecast/matcher.js";
import { parseQuestion } from "../src/core/forecast/schema.js";
import { createForecastService } from "../src/core/services/forecast.js";
import { stableStringify } from "../src/core/stable-json.js";
import {
  FROZEN_NOW,
  fakeOrder,
  fixtureCatalogue,
  fixtureHunchApi,
  frozenClock,
} from "./helpers.js";

/**
 * Golden matcher fixtures: real questions against the recorded live catalogue
 * (184 markets, captured 2026-07-05). Each entry pins the market the desk must
 * pick — regressions in tokenization/scoring show up as slug changes here.
 */
const GOLDEN_MATCHES: Array<{
  question: string;
  token?: string;
  expect: string;
}> = [
  // token milestones
  { question: "Will $AIXBT reach $50M market cap by July 15?", expect: "aixbt-50m-mcap-2026-07-15" },
  { question: "Will AIXBT hit a $50 million mcap?", token: "AIXBT", expect: "aixbt-50m-mcap-2026-07-15" },
  { question: "Will $CARDS reach $100M market cap?", expect: "cards-100m-mcap-2026-07-10" },
  { question: "Will $NEST reach a $10M market cap?", expect: "nest-10m" },
  { question: "Will $ZBASE reach $1M market cap by July 30?", expect: "zbase-1m-mcap-2026-07-30" },
  { question: "Can $BASEMATE get to a 1 million dollar market cap?", expect: "basemate-1m-mcap-2026-07-15" },
  // flips
  { question: "Will $ANSEM flip $PUMP?", expect: "ansem-flip-pump-dec-31-2026" },
  { question: "Will $HUNCH flip $aeon before July 30?", expect: "hunch-flip-aeon-jun-15-2026" },
  { question: "Will $HUNCH flip $DRB?", expect: "hunch-flip-drb-jun-15-2026" },
  // ladders and recurring rounds
  { question: "Which market-cap band will $BTC close in this week?", expect: "btc-mcap-ladder-2026-06-29" },
  { question: "Will $BTC be UP at the end of this hour?", expect: "btc-up-down-hourly-2026-07-05T22" },
  { question: "$DOGE up or down this hour?", expect: "doge-up-down-hourly-2026-07-05T22" },
  { question: "How high will $SOL peak this week?", expect: "sol-price-peak-2026-06-29" },
  { question: "Will bitcoin be up this hour?", expect: "btc-up-down-hourly-2026-07-05T22" },
  // chain / event / metric markets
  { question: "Will Base reach 5,000 TPS by December 31, 2026?", expect: "base-5k-tps-2026-12-31" },
  { question: "Will Base's total stablecoin market cap reach $10B?", expect: "base-stablecoins-10b-2026-12-31" },
  { question: "Will Base have higher 7-day DEX volume than Solana?", expect: "base-vs-solana-dex-volume-2026-12-31" },
  { question: "Will Base officially launch a token by December 31, 2026?", expect: "base-token-launch-2026-12-31" },
  { question: "Will Arbitrum's DeFi TVL reach $2B by July 31?", expect: "arb-defi-tvl-2b" },
  { question: "Will $HYPE become a top-5 cryptocurrency by market cap?", expect: "hype-top-5-2026-12-31" },
  { question: "Will Bankr beat pump.fun on daily launchpad volume on at least 3 days?", expect: "bankr-pumpfun-3d-mcap-2026-06-07" },
  { question: "Will $ANSEM close green on all 7 daily candles from July 4-10?", expect: "ansem-green-candles-7d-jul-2026" },
];

const GOLDEN_NO_MARKET: string[] = [
  "Will it rain in Tokyo tomorrow?",
  "Who will win the 2026 World Cup?",
  "Will $NONEXISTENTCOIN reach $5M market cap?",
  "asdf qwerty zxcv lorem ipsum",
  "Will the Federal Reserve cut interest rates in September?",
];

describe("forecast matcher goldens (recorded live catalogue)", () => {
  const catalogue = fixtureCatalogue();

  it.each(GOLDEN_MATCHES)("matches: $question", ({ question, token, expect: slug }) => {
    const parsed = parseQuestion({ question, ...(token ? { token } : {}) });
    const result = matchQuestion(parsed, catalogue, frozenClock);
    expect(result.best, `no match ≥ threshold; top: ${result.candidates[0]?.market.id} @ ${result.candidates[0]?.score}`).not.toBeNull();
    expect(result.best?.market.id).toBe(slug);
  });

  it.each(GOLDEN_NO_MARKET.map((q) => ({ question: q })))(
    "no market: $question",
    ({ question }) => {
      const parsed = parseQuestion({ question });
      const result = matchQuestion(parsed, catalogue, frozenClock);
      expect(
        result.best,
        `unexpected match: ${result.best?.market.id} @ ${result.best?.score}`,
      ).toBeNull();
    },
  );

  it("only ever surfaces markets that exist in the catalogue", () => {
    const allIds = new Set(
      catalogue.categories.flatMap((c) => c.markets.map((m) => m.id)),
    );
    const probes = [
      ...GOLDEN_MATCHES.map((g) => g.question),
      ...GOLDEN_NO_MARKET,
      "btc eth sol flip mcap price band volume tvl week hour",
      "$HUNCH $BTC $ETH everything everywhere",
    ];
    for (const question of probes) {
      const result = matchQuestion(parseQuestion({ question }), catalogue, frozenClock);
      for (const candidate of result.candidates) {
        expect(allIds.has(candidate.market.id)).toBe(true);
      }
    }
  });

  it("excludes closed and expired markets", () => {
    const markets = openMarkets(catalogue, frozenClock.now());
    for (const market of markets) {
      expect(market.status).toBe("open");
      expect(Date.parse(market.deadlineAt)).toBeGreaterThan(
        frozenClock.now().getTime(),
      );
    }
  });
});

describe("forecast service end-to-end (mock adapter)", () => {
  const hunch = fixtureHunchApi();
  const service = createForecastService(hunch);

  it("delivers a money-backed probability for a matched market with live pool", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "",
      input: { question: "Will $ANSEM flip $PUMP before Dec 31, 2026?" },
      clock: frozenClock,
    });
    expect(payload.status).toBe("ok");
    expect(payload.marketId).toBe("ansem-flip-pump-dec-31-2026");
    expect(payload.probability).toBe(0.92);
    expect(payload.poolUsd).toBe(12);
    expect(payload.confidence).toBe("low");
    const provenance = payload.provenance as Array<{ url: string }>;
    expect(provenance.length).toBeGreaterThanOrEqual(2);
    expect(payload.marketUrl).toContain("playhunch.xyz");
  });

  it("marks unbet markets as prior_only — never fakes conviction", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "",
      input: { question: "Will $AIXBT reach $50M market cap by July 15?" },
      clock: frozenClock,
    });
    expect(payload.status).toBe("ok");
    expect(payload.probability).toBe(0.5);
    expect(payload.confidence).toBe("prior_only");
    // dexscreener token reading rides along in provenance
    const provenance = payload.provenance as Array<{ source: string }>;
    expect(provenance.some((p) => p.source === "dexscreener")).toBe(true);
  });

  it("returns no_market + spawnHint when nothing matches", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "",
      input: {
        question: "Will $NONEXISTENTCOIN reach $5M market cap in 30 days?",
      },
      clock: frozenClock,
    });
    expect(payload.status).toBe("no_market");
    const hint = payload.spawnHint as {
      service: string;
      input: { token?: string; targetUsd?: number; horizonDays?: number };
    };
    expect(hint.service).toBe("spawn");
    expect(hint.input.token).toBe("NONEXISTENTCOIN");
    expect(hint.input.targetUsd).toBe(5_000_000);
    expect(hint.input.horizonDays).toBe(30);
  });

  /**
   * A no_market still costs the buyer $0.25, so it has to carry something they
   * can act on. Two guarantees: we tell them which tokens DO have a live book,
   * and any near-miss we surface is priced off the real pool — never a guess.
   */
  it("no_market reports live token coverage so the buyer can re-ask", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "",
      input: { question: "Will $NONEXISTENTCOIN reach $5M market cap in 30 days?" },
      clock: frozenClock,
    });
    expect(payload.status).toBe("no_market");
    const coverage = payload.coverage as {
      tokensWithLiveMarkets: string[];
      askedToken: string | null;
      askedTokenCovered: boolean | null;
    };
    expect(coverage.askedToken).toBe("NONEXISTENTCOIN");
    expect(coverage.askedTokenCovered).toBe(false);
    // The fixture catalogue really does book these — a buyer can re-ask now.
    expect(coverage.tokensWithLiveMarkets).toContain("AIXBT");
    expect(coverage.tokensWithLiveMarkets).toContain("BTC");
    expect(coverage.tokensWithLiveMarkets).not.toContain("NONEXISTENTCOIN");
    // Sorted + deduped: the list is a stable part of the deliverable hash.
    expect(coverage.tokensWithLiveMarkets).toEqual(
      [...new Set(coverage.tokensWithLiveMarkets)].sort(),
    );
  });

  it("prices every near-miss it surfaces, or marks it unpriced", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "",
      input: {
        question: "Will the Federal Reserve cut interest rates in September?",
      },
      clock: frozenClock,
    });
    expect(payload.status).toBe("no_market");
    const nearMisses = payload.nearMisses as Array<{
      marketSlug: string;
      score: number;
      threshold: number;
      priced: boolean;
      probability?: number | null;
      poolUsd?: number;
      confidence?: string;
    }>;
    expect(nearMisses.length).toBeGreaterThan(0);
    for (const miss of nearMisses) {
      // Every near-miss is below threshold by definition — that is why it is a
      // near-miss and not the answer.
      expect(miss.score).toBeLessThan(miss.threshold);
      if (!miss.priced) continue;
      expect(typeof miss.poolUsd).toBe("number");
      expect(miss.confidence).toBeTruthy();
      if (miss.probability !== null && miss.probability !== undefined) {
        expect(miss.probability).toBeGreaterThanOrEqual(0);
        expect(miss.probability).toBeLessThanOrEqual(1);
      }
    }
  });

  it("answers ladder markets with the full outcome book", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "",
      input: { question: "Which market-cap band will $ADA close in this week?" },
      clock: frozenClock,
    });
    expect(payload.status).toBe("ok");
    expect(payload.marketId).toBe("ada-mcap-ladder-2026-06-29");
    const odds = payload.odds as Record<string, number>;
    expect(Object.keys(odds).length).toBeGreaterThanOrEqual(4);
    const ladder = payload.ladder as { outcomes: Array<{ key: string }> };
    expect(ladder.outcomes.length).toBeGreaterThanOrEqual(4);
    // probability = top bucket's implied price
    expect(payload.probability).toBe(Math.max(...Object.values(odds)) / 100);
  });

  it("finds factory-spawned markets via the discover merge (the flywheel)", async () => {
    const factoryMarket = {
      id: "factory-virtual-1b-2026-08-05",
      slug: "factory-virtual-1b-2026-08-05",
      question: "Will $VIRTUAL reach a $1B market cap before Aug 5, 2026?",
      shortTitle: "$VIRTUAL $1B by Aug 5",
      summary: "Factory-minted milestone market.",
      category: "market_cap",
      tokenSymbol: "VIRTUAL",
      chainId: "base",
      deadlineAt: "2026-08-05T23:59:00.000Z",
      deadlineLabel: "Aug 5",
      status: "open",
      feeBps: 200,
      defaultTicketUsd: 1,
      virtualLiquidityUsd: 10000,
      targetMarketCapUsd: 1_000_000_000,
      outcomes: null,
      links: {
        app: "https://www.playhunch.xyz/markets/factory-virtual-1b-2026-08-05",
        quote: "https://www.playhunch.xyz/api/partner/quote?marketId=factory-virtual-1b-2026-08-05",
        trade: "https://www.playhunch.xyz/api/partner/trade",
      },
    };
    const question = "Will $VIRTUAL reach a $1B market cap before Aug 5?";
    const hunchWithDiscover = new MockHunchApi({
      catalogue: fixtureCatalogue(), // has NO virtual milestone market
      readAt: FROZEN_NOW,
      synthesizeQuotes: true,
      quotes: {
        [factoryMarket.id]: {
          market: factoryMarket,
          side: "yes",
          odds: { yesPriceCents: 50, noPriceCents: 50 },
          stats: { totalBets: 0, totalPoolUsd: 0, feeUsd: 0 },
          tokenSnapshot: null,
        },
      },
      discoveries: {
        [question]: { count: 1, matches: [{ market: factoryMarket }] },
      },
    });
    const flywheelService = createForecastService(hunchWithDiscover);
    const payload = await flywheelService.handle({
      order: fakeOrder(),
      requirements: "",
      input: { question },
      clock: frozenClock,
    });
    expect(payload.status).toBe("ok");
    expect(payload.marketId).toBe("factory-virtual-1b-2026-08-05");
    const provenance = payload.provenance as Array<{ source: string }>;
    expect(provenance.some((p) => p.source.includes("discover"))).toBe(true);
  });

  it("accepts a bare-string requirement as the question", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "Will $CARDS reach $100M market cap?",
      input: null,
      clock: frozenClock,
    });
    expect(payload.status).toBe("ok");
    expect(payload.marketId).toBe("cards-100m-mcap-2026-07-10");
  });

  it("rejects invalid input (loop → reject → escrow refund)", async () => {
    await expect(
      service.handle({
        order: fakeOrder(),
        requirements: "",
        input: { question: "hi" },
        clock: frozenClock,
      }),
    ).rejects.toThrow(/invalid forecast input/);
  });

  it("is byte-deterministic: identical inputs → identical deliverable bytes", async () => {
    const run = () =>
      service.handle({
        order: fakeOrder(),
        requirements: "",
        input: { question: "Will $ANSEM flip $PUMP?" },
        clock: frozenClock,
      });
    const [a, b] = await Promise.all([run(), run()]);
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
});
