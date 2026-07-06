/**
 * The one implementation of a single hedge leg's economics. Both `hedge-quote`
 * (S9, one leg) and `portfolio-hedge` (S13, a basket of legs) price through this,
 * so their numbers are identical by construction. Pure arithmetic off the live
 * marginal price + the market fee — no LLM, no fabricated edge.
 *
 *   fee    = stake · feeBps/1e4
 *   net    = stake − fee
 *   shares = net / price           (price = priceCents/100, the $1-payout cost)
 *   payout = shares · $1
 */

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round4 = (n: number) => Math.round((n + Number.EPSILON) * 1e4) / 1e4;
export const round6 = (n: number) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;

/**
 * Back-solve the stake needed to buy a target payout ("coverage"):
 *   coverage = stake · (1 − feeRate) / price  ⇒  stake = coverage · price / (1 − feeRate)
 */
export function stakeForCoverage(
  coverageUsd: number,
  price: number,
  feeRate: number,
): number {
  return (coverageUsd * price) / (1 - feeRate);
}

export interface LegInputs {
  /** Marginal price of the hedged outcome, in cents (1..99). */
  priceCents: number;
  /** Market fee in basis points. */
  feeBps: number;
  /** Market minimum ticket — flags a leg sized below it. */
  defaultTicketUsd: number;
  /** Requested premium before the deterministic cap. */
  rawStakeUsd: number;
  /** Deterministic per-leg cap; the LLM never sizes a hedge, this does. */
  maxStakeUsd: number;
}

export interface LegEconomics {
  stakeUsd: number;
  feeUsd: number;
  feeBps: number;
  netUsd: number;
  shares: number;
  payoutIfWinUsd: number;
  profitIfWinUsd: number;
  returnMultiple: number;
  breakevenProbability: number;
  maxStakeUsd: number;
  /** True when the requested stake was clamped down to the cap. */
  capApplied: boolean;
  belowMinTicket: boolean;
}

/**
 * Price one leg. The stake is `min(rawStake, maxStake)` (clamped, never silently
 * honoured over the cap); every downstream number is derived from it and the
 * live price. Rounding matches S9 exactly, so hedge-quote's golden tests are the
 * regression guard for this module.
 */
export function priceLeg(inputs: LegInputs): LegEconomics {
  const price = inputs.priceCents / 100;
  const feeRate = inputs.feeBps / 10_000;

  const capApplied = inputs.rawStakeUsd > inputs.maxStakeUsd + 1e-9;
  const stakeUsd = round2(Math.min(inputs.rawStakeUsd, inputs.maxStakeUsd));
  const feeUsd = round2(stakeUsd * feeRate);
  const netUsd = round2(stakeUsd - feeUsd);
  const shares = round6(netUsd / price);
  const payoutIfWinUsd = round2(shares);
  const profitIfWinUsd = round2(payoutIfWinUsd - stakeUsd);
  const returnMultiple = round4(payoutIfWinUsd / stakeUsd);

  return {
    stakeUsd,
    feeUsd,
    feeBps: inputs.feeBps,
    netUsd,
    shares,
    payoutIfWinUsd,
    profitIfWinUsd,
    returnMultiple,
    breakevenProbability: round4(price),
    maxStakeUsd: inputs.maxStakeUsd,
    capApplied,
    belowMinTicket: stakeUsd < inputs.defaultTicketUsd,
  };
}
