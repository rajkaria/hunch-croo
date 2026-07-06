import { describe, expect, it } from "vitest";
import { priceLeg, stakeForCoverage } from "../src/core/hedge/leg.js";

/**
 * The shared single-leg economics. These golden numbers are the same ones
 * hedge-quote's suite asserts end-to-end — this proves the extracted module
 * computes them identically, so the S9 refactor is behaviour-preserving.
 */
describe("priceLeg", () => {
  it("prices a cheap-side stake exactly as hedge-quote does (ansem NO $5 @ 8c)", () => {
    const eco = priceLeg({
      priceCents: 8,
      feeBps: 200,
      defaultTicketUsd: 1,
      rawStakeUsd: 5,
      maxStakeUsd: 10,
    });
    expect(eco.stakeUsd).toBe(5);
    expect(eco.feeUsd).toBe(0.1);
    expect(eco.netUsd).toBe(4.9);
    expect(eco.shares).toBe(61.25);
    expect(eco.payoutIfWinUsd).toBe(61.25);
    expect(eco.profitIfWinUsd).toBe(56.25);
    expect(eco.returnMultiple).toBe(12.25);
    expect(eco.breakevenProbability).toBe(0.08);
    expect(eco.capApplied).toBe(false);
  });

  it("clamps an oversized stake to the per-leg cap (LLM never sizes)", () => {
    const eco = priceLeg({
      priceCents: 50,
      feeBps: 200,
      defaultTicketUsd: 1,
      rawStakeUsd: 100,
      maxStakeUsd: 10,
    });
    expect(eco.stakeUsd).toBe(10);
    expect(eco.capApplied).toBe(true);
    expect(eco.shares).toBe(19.6); // 9.8 net / 0.50
  });

  it("prices a ladder-outcome leg by its price (le-n20 @ 16c)", () => {
    const eco = priceLeg({
      priceCents: 16,
      feeBps: 200,
      defaultTicketUsd: 1,
      rawStakeUsd: 5,
      maxStakeUsd: 10,
    });
    expect(eco.shares).toBe(30.625); // 4.9 / 0.16
    expect(eco.breakevenProbability).toBe(0.16);
  });

  it("flags a leg sized below the market minimum ticket", () => {
    const eco = priceLeg({
      priceCents: 50,
      feeBps: 200,
      defaultTicketUsd: 5,
      rawStakeUsd: 2,
      maxStakeUsd: 10,
    });
    expect(eco.stakeUsd).toBe(2);
    expect(eco.belowMinTicket).toBe(true);
  });
});

describe("stakeForCoverage", () => {
  it("back-solves the stake for a target payout (round-trips with priceLeg)", () => {
    // $9.80 coverage on a 50c book at 2% fee costs a $5 premium.
    const stake = stakeForCoverage(9.8, 0.5, 0.02);
    expect(stake).toBeCloseTo(5, 10);
    const eco = priceLeg({
      priceCents: 50,
      feeBps: 200,
      defaultTicketUsd: 1,
      rawStakeUsd: stake,
      maxStakeUsd: 10,
    });
    expect(eco.payoutIfWinUsd).toBe(9.8);
  });
});
