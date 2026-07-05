import { z } from "zod";

/**
 * The forecast question contract. `question` is free text; the optional hints
 * (`token`, `type`, `horizonDays`) tighten matching when the caller already
 * knows them. Deliberately small — every field beyond `question` is advisory.
 */
export const ForecastInputSchema = z.object({
  question: z.string().trim().min(3).max(500),
  /** Token symbol hint, with or without the $ (e.g. "AIXBT" or "$aixbt"). */
  token: z
    .string()
    .trim()
    .regex(/^\$?[a-zA-Z0-9]{1,20}$/)
    .optional(),
  /** Market-category hint (matches Hunch catalogue category keys loosely). */
  type: z.string().trim().max(50).optional(),
  /** How far out the caller cares about, in days. */
  horizonDays: z.number().int().positive().max(730).optional(),
});

export type ForecastInput = z.infer<typeof ForecastInputSchema>;

export interface ParsedQuestion {
  raw: string;
  /** Lowercased meaningful tokens (stopwords removed). */
  tokens: string[];
  /** Cashtags found in the question (uppercased, no $). */
  cashtags: string[];
  /** Explicit token hint, normalized (uppercased, no $). */
  tokenHint: string | null;
  /** USD numbers found (e.g. "$100m" → 100_000_000). */
  usdTargets: number[];
  /** Category signals detected from keywords. */
  categoryHints: string[];
  horizonDays: number | null;
}

const STOPWORDS = new Set([
  "will",
  "the",
  "a",
  "an",
  "by",
  "to",
  "of",
  "in",
  "on",
  "at",
  "is",
  "be",
  "before",
  "after",
  "does",
  "do",
  "did",
  "can",
  "it",
  "its",
  "this",
  "that",
  "and",
  "or",
  "what",
  "which",
  "when",
  "how",
  "likely",
  "chance",
  "probability",
  "than",
  "least",
  "most",
  "any",
  "all",
]);

/** keyword → Hunch market category families it suggests. */
const CATEGORY_KEYWORDS: Array<[RegExp, string]> = [
  [/\bflip(s|ped|ping)?\b/, "token_mcap_flip"],
  [/\bmarket ?cap\b|\bmcap\b|\bfdv\b/, "market_cap"],
  [/\bgreen candle(s)?\b|\bcandle(s)? green\b/, "token_green_candle_streak"],
  [/\bclose(s)? above\b.*\b(day|daily|candle)/, "token_mcap_close_days"],
  [/\bprice\b|\btrade(s)? (above|below)\b/, "price"],
  [/\bband\b|\bladder\b|\brange\b/, "range"],
  [/\bvolume\b/, "volume"],
  [/\btvl\b|\btotal value locked\b/, "tvl"],
  [/\bup or down\b|\bhigher or lower\b|\bup\/down\b/, "recurring"],
  [/\bstablecoin(s)?\b/, "chain-stablecoins"],
  [/\bthroughput\b|\btps\b/, "chain-throughput"],
];

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
  t: 1_000_000_000_000,
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
  trillion: 1_000_000_000_000,
};

export function extractUsdTargets(text: string): number[] {
  const out: number[] = [];
  const pattern =
    /\$?\s?(\d+(?:[.,]\d+)?)\s*(k|m|b|t|thousand|million|billion|trillion)?\b/gi;
  for (const match of text.matchAll(pattern)) {
    const rawNumber = match[1]?.replace(",", "");
    if (!rawNumber) continue;
    const base = Number.parseFloat(rawNumber);
    if (!Number.isFinite(base)) continue;
    const suffix = match[2]?.toLowerCase();
    const multiplier = suffix ? (MULTIPLIERS[suffix] ?? 1) : 1;
    const value = base * multiplier;
    // Years and small bare numbers are not USD targets.
    if (!suffix && (value < 10_000 || (value >= 1900 && value <= 2100))) continue;
    out.push(value);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export function extractCashtags(text: string): string[] {
  const tags = new Set<string>();
  for (const match of text.matchAll(/\$([a-zA-Z][a-zA-Z0-9]{0,19})\b/g)) {
    const tag = match[1];
    if (!tag) continue;
    // "$100m" style amounts are targets, not tickers.
    if (/^\d/.test(tag)) continue;
    tags.add(tag.toUpperCase());
  }
  return [...tags];
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\$\d[\w.,]*/g, " ") // drop dollar amounts
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

const HORIZON_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => number]> = [
  [/\bnext (\d+) days?\b/i, (m) => Number(m[1])],
  [/\bwithin (\d+) days?\b/i, (m) => Number(m[1])],
  [/\b(\d+) days?\b/i, (m) => Number(m[1])],
  [/\bthis week\b|\bnext week\b/i, () => 7],
  [/\bthis month\b|\bnext month\b/i, () => 30],
  [/\bthis year\b|\bend of (the )?year\b|\beoy\b/i, () => 365],
];

export function extractHorizonDays(text: string): number | null {
  for (const [pattern, toDays] of HORIZON_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const days = toDays(match);
      if (Number.isFinite(days) && days > 0) return days;
    }
  }
  return null;
}

export function parseQuestion(input: ForecastInput): ParsedQuestion {
  const raw = input.question;
  const categoryHints: string[] = [];
  const lower = raw.toLowerCase();
  for (const [pattern, category] of CATEGORY_KEYWORDS) {
    if (pattern.test(lower)) categoryHints.push(category);
  }
  if (input.type) categoryHints.push(input.type.toLowerCase());

  return {
    raw,
    tokens: tokenize(raw),
    cashtags: extractCashtags(raw),
    tokenHint: input.token ? input.token.replace(/^\$/, "").toUpperCase() : null,
    usdTargets: extractUsdTargets(raw),
    categoryHints: [...new Set(categoryHints)],
    horizonDays: input.horizonDays ?? extractHorizonDays(raw),
  };
}
