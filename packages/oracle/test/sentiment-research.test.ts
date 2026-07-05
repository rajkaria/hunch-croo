import { describe, expect, it } from "vitest";
import { createResearchService } from "../src/core/services/research.js";
import { createSentimentService } from "../src/core/services/sentiment.js";
import { SERVICE_PRICING } from "../src/core/pricing.js";
import { stableStringify } from "../src/core/stable-json.js";
import { fakeOrder, fixtureHunchApi, frozenClock } from "./helpers.js";

describe("sentiment service", () => {
  const hunch = fixtureHunchApi();
  const service = createSentimentService(hunch);

  it("aggregates pool-weighted conviction across a token's live books", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "",
      input: { token: "$ansem" },
      clock: frozenClock,
    });
    expect(payload.status).toBe("ok");
    expect(payload.token).toBe("ANSEM");
    expect(payload.marketsQuoted).toBeGreaterThanOrEqual(2);
    const signals = payload.signals as Array<{ inLean: boolean; kind: string }>;
    expect(signals.length).toBeGreaterThanOrEqual(2);
    expect(typeof payload.leanScore).toBe("number");
    expect(["bullish", "bearish", "neutral"]).toContain(payload.lean);
    // ladders are context, never part of the lean
    for (const signal of signals) {
      if (signal.kind === "ladder") expect(signal.inLean).toBe(false);
    }
  });

  it("returns no_signal + spawnHint for unknown tokens", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "",
      input: { token: "NOSUCHTOKEN" },
      clock: frozenClock,
    });
    expect(payload.status).toBe("no_signal");
    const hint = payload.spawnHint as { input: { token: string } };
    expect(hint.input.token).toBe("NOSUCHTOKEN");
  });

  it("accepts bare requirements as the token", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "BTC",
      input: null,
      clock: frozenClock,
    });
    expect(payload.status).toBe("ok");
    expect(payload.token).toBe("BTC");
  });

  it("rejects invalid input", async () => {
    await expect(
      service.handle({
        order: fakeOrder(),
        requirements: "",
        input: { token: "not a symbol!!" },
        clock: frozenClock,
      }),
    ).rejects.toThrow(/invalid sentiment input/);
  });

  it("is byte-deterministic", async () => {
    const run = () =>
      service.handle({
        order: fakeOrder(),
        requirements: "",
        input: { token: "ANSEM" },
        clock: frozenClock,
      });
    const [a, b] = await Promise.all([run(), run()]);
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
});

describe("research service", () => {
  const hunch = fixtureHunchApi();
  const service = createResearchService(hunch);

  it("bundles odds, stats, resolution criteria and related markets by slug", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "",
      input: { marketSlug: "ansem-flip-pump-dec-31-2026" },
      clock: frozenClock,
    });
    expect(payload.status).toBe("ok");
    const market = payload.market as { marketId: string; url: string };
    expect(market.marketId).toBe("ansem-flip-pump-dec-31-2026");
    const criteria = payload.resolutionCriteria as {
      summary: string;
      disclosure?: string;
    };
    expect(criteria.summary.length).toBeGreaterThan(20);
    expect(criteria.disclosure).toBeTruthy();
    const related = payload.related as Array<{ marketId: string }>;
    expect(related.length).toBeGreaterThanOrEqual(1);
    // every related market shares the token or category, never the market itself
    expect(related.some((r) => r.marketId === market.marketId)).toBe(false);
    expect(payload.trendingRank).toBe(1);
  });

  it("resolves the short slug too", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "",
      input: { marketSlug: "ansem-flip-pump" },
      clock: frozenClock,
    });
    expect(payload.status).toBe("ok");
    expect((payload.market as { marketId: string }).marketId).toBe(
      "ansem-flip-pump-dec-31-2026",
    );
  });

  it("answers free-text questions through the matcher", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "",
      input: { question: "Will $AIXBT reach $50M market cap?" },
      clock: frozenClock,
    });
    expect(payload.status).toBe("ok");
    expect((payload.market as { marketId: string }).marketId).toBe(
      "aixbt-50m-mcap-2026-07-15",
    );
    expect(payload.matchScore).toBeGreaterThan(0);
  });

  it("returns no_market for unmatchable questions", async () => {
    const payload = await service.handle({
      order: fakeOrder(),
      requirements: "",
      input: { question: "Will it snow in Lagos tomorrow?" },
      clock: frozenClock,
    });
    expect(payload.status).toBe("no_market");
  });

  it("rejects input with neither slug nor question", async () => {
    await expect(
      service.handle({
        order: fakeOrder(),
        requirements: "",
        input: {},
        clock: frozenClock,
      }),
    ).rejects.toThrow(/invalid research input/);
  });
});

describe("pricing table", () => {
  it("covers the whole catalog with sane prices and SLAs", () => {
    const services = Object.keys(SERVICE_PRICING);
    expect(services).toEqual(
      expect.arrayContaining([
        "forecast",
        "sentiment",
        "research",
        "verify",
        "watch",
        "spawn",
        "hedge-quote",
      ]),
    );
    for (const [name, pricing] of Object.entries(SERVICE_PRICING)) {
      expect(pricing.priceUsd, name).toBeGreaterThan(0);
      expect(pricing.priceUsd, name).toBeLessThanOrEqual(5);
      expect(pricing.slaMinutes, name).toBeGreaterThanOrEqual(5);
      expect(pricing.summary.length, name).toBeGreaterThan(20);
    }
    // exactly three listings — the onboarding-reward cap
    const listings = new Set(
      Object.values(SERVICE_PRICING).map((p) => p.listing),
    );
    expect(listings.size).toBe(3);
  });
});
