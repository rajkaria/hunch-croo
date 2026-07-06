import type { Clock } from "../../ports/runtime.js";
import type { HunchCatalogue, HunchCatalogueEntry } from "../../ports/hunch.js";
import { tokenize, type ParsedQuestion } from "./schema.js";

/**
 * Deterministic market matcher: scores every open catalogue market against the
 * parsed question. No LLM in the loop — token identity, USD-target proximity,
 * category signals, lexical overlap and deadline fit. The matcher can only
 * ever return a market that exists in the catalogue (property-tested).
 *
 * Scoring (max ~100):
 *   token match        45  (the single strongest signal)
 *   target proximity   20  (log-distance between question $ and market target)
 *   category hint      15
 *   lexical overlap    15
 *   deadline fit        5
 */
export interface MatchCandidate {
  market: HunchCatalogueEntry;
  score: number;
  breakdown: {
    token: number;
    target: number;
    category: number;
    lexical: number;
    deadline: number;
  };
}

export interface MatchResult {
  best: MatchCandidate | null;
  candidates: MatchCandidate[];
  openMarkets: number;
}

/** Minimum score for a confident match; below → no_market + spawnHint. */
export const MATCH_THRESHOLD = 40;

/**
 * Token identity score. When the question names tokens explicitly (cashtags /
 * hint) and the market covers NONE of them, the market is disqualified — a
 * $5M-target market about a different token is a wrong answer, not a weak one.
 */
function scoreToken(
  question: ParsedQuestion,
  market: HunchCatalogueEntry,
): number | "disqualified" {
  const wanted = new Set<string>();
  if (question.tokenHint) wanted.add(question.tokenHint);
  for (const tag of question.cashtags) wanted.add(tag);
  if (wanted.size === 0) {
    // Fall back to bare-word symbol mentions ("bitcoin", "btc" without $).
    const marketSymbols = symbolSet(market);
    for (const token of question.tokens) {
      if (marketSymbols.has(token.toUpperCase())) return 30;
    }
    return 0;
  }
  const marketSymbols = symbolSet(market);
  for (const symbol of wanted) {
    if (marketSymbols.has(symbol)) return 45;
  }
  return "disqualified";
}

const SYMBOL_ALIASES: Record<string, string[]> = {
  BTC: ["BITCOIN"],
  ETH: ["ETHEREUM", "ETHER"],
  SOL: ["SOLANA"],
  DOGE: ["DOGECOIN"],
  BNKR: ["BANKR"],
  AVAX: ["AVALANCHE"],
  LINK: ["CHAINLINK"],
  ADA: ["CARDANO"],
};

function symbolSet(market: HunchCatalogueEntry): Set<string> {
  const symbols = new Set<string>();
  if (market.tokenSymbol) symbols.add(market.tokenSymbol.toUpperCase());
  for (const s of market.tokenSymbols ?? []) symbols.add(s.toUpperCase());
  for (const symbol of [...symbols]) {
    for (const alias of SYMBOL_ALIASES[symbol] ?? []) symbols.add(alias);
  }
  return symbols;
}

function scoreTarget(question: ParsedQuestion, market: HunchCatalogueEntry): number {
  if (question.usdTargets.length === 0 || !market.targetMarketCapUsd) return 0;
  const target = market.targetMarketCapUsd;
  let best = 0;
  for (const asked of question.usdTargets) {
    if (asked <= 0) continue;
    const ratio = Math.abs(Math.log10(asked / target));
    // ratio 0 → exact (20 pts); one order of magnitude off → 0.
    const score = Math.max(0, Math.round(20 * (1 - ratio)));
    best = Math.max(best, score);
  }
  return best;
}

function scoreCategory(
  question: ParsedQuestion,
  market: HunchCatalogueEntry,
): number {
  if (question.categoryHints.length === 0) return 0;
  const marketCategories = [
    market.category.toLowerCase(),
    market.categoryKey.toLowerCase(),
  ];
  let best = 0;
  for (const hint of question.categoryHints) {
    for (const category of marketCategories) {
      if (category === hint) best = Math.max(best, 15);
      else if (category.includes(hint) || hint.includes(category)) {
        best = Math.max(best, 10);
      }
    }
  }
  return best;
}

function scoreLexical(question: ParsedQuestion, market: HunchCatalogueEntry): number {
  if (question.tokens.length === 0) return 0;
  const marketTokens = new Set(
    tokenize(`${market.question} ${market.shortTitle} ${market.category}`),
  );
  let shared = 0;
  for (const token of question.tokens) {
    if (marketTokens.has(token)) shared += 1;
  }
  const coverage = shared / question.tokens.length;
  return Math.round(15 * coverage);
}

function scoreDeadline(
  question: ParsedQuestion,
  market: HunchCatalogueEntry,
  now: Date,
): number {
  if (!question.horizonDays) return 0;
  const deadline = Date.parse(market.deadlineAt);
  if (!Number.isFinite(deadline)) return 0;
  const daysToDeadline = (deadline - now.getTime()) / 86_400_000;
  if (daysToDeadline <= 0) return 0;
  const ratio = daysToDeadline / question.horizonDays;
  // Perfect when the market deadline sits at or just inside the horizon.
  if (ratio >= 0.5 && ratio <= 1.5) return 5;
  if (ratio > 0.2 && ratio < 3) return 2;
  return 0;
}

export function openMarkets(
  catalogue: HunchCatalogue,
  now: Date,
): HunchCatalogueEntry[] {
  const seen = new Set<string>();
  const out: HunchCatalogueEntry[] = [];
  for (const category of catalogue.categories) {
    for (const market of category.markets) {
      if (seen.has(market.id)) continue;
      seen.add(market.id);
      if (market.status !== "open") continue;
      const deadline = Date.parse(market.deadlineAt);
      if (Number.isFinite(deadline) && deadline <= now.getTime()) continue;
      out.push(market);
    }
  }
  return out;
}

export function matchQuestion(
  question: ParsedQuestion,
  catalogue: HunchCatalogue,
  clock: Clock,
  /**
   * Markets to score beyond the static catalogue — factory-minted markets
   * surface through /discover, not /catalogue, so the flywheel's re-forecast
   * finds what spawn just created. Same open/deadline filters apply.
   */
  extraMarkets: HunchCatalogueEntry[] = [],
): MatchResult {
  const now = clock.now();
  const markets = openMarkets(catalogue, now);
  const seen = new Set(markets.map((m) => m.id));
  for (const market of extraMarkets) {
    if (seen.has(market.id)) continue;
    seen.add(market.id);
    if (market.status !== "open") continue;
    const deadline = Date.parse(market.deadlineAt);
    if (Number.isFinite(deadline) && deadline <= now.getTime()) continue;
    markets.push(market);
  }

  const candidates: MatchCandidate[] = [];
  for (const market of markets) {
    const token = scoreToken(question, market);
    if (token === "disqualified") continue;
    const breakdown = {
      token,
      target: scoreTarget(question, market),
      category: scoreCategory(question, market),
      lexical: scoreLexical(question, market),
      deadline: scoreDeadline(question, market, now),
    };
    const score =
      breakdown.token +
      breakdown.target +
      breakdown.category +
      breakdown.lexical +
      breakdown.deadline;
    candidates.push({ market, score, breakdown });
  }

  // Deterministic order: score desc, then id asc as the stable tiebreak.
  candidates.sort(
    (a, b) => b.score - a.score || a.market.id.localeCompare(b.market.id),
  );

  const top = candidates[0];
  return {
    best: top && top.score >= MATCH_THRESHOLD ? top : null,
    candidates: candidates.slice(0, 5),
    openMarkets: markets.length,
  };
}
