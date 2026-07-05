import { describe, expect, it } from "vitest";
import {
  extractCashtags,
  extractHorizonDays,
  extractUsdTargets,
  parseQuestion,
  tokenize,
} from "../src/core/forecast/schema.js";
import { confidenceFor } from "../src/core/forecast/composer.js";

describe("question parsing", () => {
  it("extracts USD targets with k/m/b suffixes", () => {
    expect(extractUsdTargets("Will $CARDS reach $100M market cap?")).toEqual([
      100_000_000,
    ]);
    expect(extractUsdTargets("hit 50 million or $2.5b")).toEqual([
      50_000_000, 2_500_000_000,
    ]);
    expect(extractUsdTargets("a $10k pot")).toEqual([10_000]);
  });

  it("ignores years, counts and small bare numbers", () => {
    expect(extractUsdTargets("by December 31, 2026")).toEqual([]);
    expect(extractUsdTargets("reach 5,000 TPS")).toEqual([]);
    expect(extractUsdTargets("top-5 cryptocurrency")).toEqual([]);
  });

  it("extracts cashtags but not dollar amounts", () => {
    expect(extractCashtags("Will $AIXBT flip $100m $PUMP?")).toEqual([
      "AIXBT",
      "PUMP",
    ]);
  });

  it("parses horizons from natural phrases", () => {
    expect(extractHorizonDays("within 30 days")).toBe(30);
    expect(extractHorizonDays("this week")).toBe(7);
    expect(extractHorizonDays("by end of year")).toBe(365);
    expect(extractHorizonDays("no horizon here")).toBeNull();
  });

  it("drops stopwords and amounts when tokenizing", () => {
    expect(tokenize("Will the $BTC reach $100m by July?")).toEqual([
      "btc",
      "reach",
      "july",
    ]);
  });

  it("parseQuestion assembles hints (explicit token beats cashtags)", () => {
    const parsed = parseQuestion({
      question: "Will $PUMP flip in 14 days?",
      token: "$ansem",
    });
    expect(parsed.tokenHint).toBe("ANSEM");
    expect(parsed.cashtags).toEqual(["PUMP"]);
    expect(parsed.categoryHints).toContain("token_mcap_flip");
    expect(parsed.horizonDays).toBe(14);
  });
});

describe("confidence taxonomy", () => {
  it("maps pool depth to honest confidence", () => {
    expect(confidenceFor(0, 0)).toBe("prior_only");
    expect(confidenceFor(5, 1)).toBe("low");
    expect(confidenceFor(30, 4)).toBe("medium");
    expect(confidenceFor(500, 25)).toBe("high");
  });
});
