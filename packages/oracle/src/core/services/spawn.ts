import { z } from "zod";
import type { HunchApi } from "../../ports/hunch.js";
import { HunchApiError } from "../../ports/hunch.js";
import type { ServiceContext, ServiceHandler } from "../service-registry.js";
import type { ProvenanceEntry } from "../forecast/composer.js";

/**
 * `spawn` — the flywheel service: mints a REAL market on playhunch.xyz through
 * the production factory and delivers the live link + seeded odds. The
 * caller's question becomes a tradeable instrument humans then price.
 *
 * Money-path invariants (mirrored from the factory itself):
 *  - deterministic zod validation; the LLM is never in this path
 *  - factory mints ONLY for the human-curated pinned-token allowlist
 *  - idempotent upstream (same token+target+day → the existing market)
 *  - after minting we CONFIRM the market quotes live before delivering —
 *    we never deliver a link we haven't seen answer
 */
export const SpawnInputSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\$?[a-zA-Z0-9]{1,20}$/, "token symbol like AIXBT or $BNKR"),
  /** Target = multiplier × current market cap (factory computes the line). */
  multiplier: z.number().gt(1).max(100).optional(),
  horizonDays: z.number().int().positive().max(365).optional(),
});

export function createSpawnService(hunch: HunchApi): ServiceHandler {
  return {
    name: "spawn",
    async handle(ctx: ServiceContext): Promise<Record<string, unknown>> {
      const parsed = SpawnInputSchema.safeParse(ctx.input);
      if (!parsed.success) {
        throw new Error(
          `invalid spawn input: ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
            .join("; ")}. Expected {"token": string, "multiplier"?: number>1, "horizonDays"?: 1-365}`,
        );
      }
      const symbol = parsed.data.token.replace(/^\$/, "").toUpperCase();

      let mintRead;
      try {
        mintRead = await hunch.mint({
          symbol,
          ...(parsed.data.multiplier !== undefined
            ? { multiplier: parsed.data.multiplier }
            : {}),
          ...(parsed.data.horizonDays !== undefined
            ? { horizonDays: parsed.data.horizonDays }
            : {}),
        });
      } catch (error) {
        if (error instanceof HunchApiError && error.status === 422) {
          throw new Error(
            `spawn rejected: $${symbol} is not on the human-curated factory allowlist (or the request was malformed): ${error.message}`,
          );
        }
        if (error instanceof HunchApiError && error.status === 429) {
          throw new Error(
            "spawn rejected: factory rate limit hit — try again shortly",
          );
        }
        throw error;
      }

      const provenance: ProvenanceEntry[] = [
        {
          source: "playhunch.xyz partner mint (production market factory)",
          url: mintRead.url,
          readAt: mintRead.readAt,
        },
      ];

      const minted = mintRead.data.market;
      const marketId = minted?.id ?? mintRead.data.marketId;
      if (!marketId) {
        throw new Error(
          "spawn failed: factory answered without a market reference",
        );
      }

      // Confirm the market is live and quotable before delivering the link.
      const quoteRead = await hunch.quote(marketId, { side: "yes", sizeUsd: 1 });
      provenance.push({
        source: "playhunch.xyz partner quote (visibility confirmation)",
        url: quoteRead.url,
        readAt: quoteRead.readAt,
      });
      const market = quoteRead.data.market;
      const odds = quoteRead.data.odds;

      return {
        service: "spawn",
        status: mintRead.data.status === "minted" ? "live" : "already_live",
        marketId: market.id,
        marketSlug: market.slug,
        marketUrl: market.links.app,
        question: market.question,
        category: market.category,
        deadlineAt: market.deadlineAt,
        seededOdds: odds,
        note:
          mintRead.data.status === "minted"
            ? "Market minted on the live production app. Humans and agents can price it right now — re-run forecast on this question to watch the probability move."
            : "An equivalent market already existed (factory is idempotent: same token+target+day). It is live and tradeable at the link.",
        provenance,
        asOf: ctx.clock.now().toISOString(),
      };
    },
  };
}
