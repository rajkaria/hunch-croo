import { z } from "zod";
import type { HunchApi, HunchVerifyClaim } from "../../ports/hunch.js";
import { HunchApiError } from "../../ports/hunch.js";
import type { ServiceContext, ServiceHandler } from "../service-registry.js";

/**
 * `verify` — TruthCheck's bridge to Hunch's production resolver stack
 * (`POST /api/partner/verify`). Claims are STRUCTURED templates; free text is
 * rejected before it goes anywhere near a resolver.
 *
 * The upstream never fabricates: source failure or uncovered history comes
 * back `indeterminate` with the reason — and that is a legitimate, deliverable
 * answer (the caller paid to know what the ground truth is, including "the
 * sources cannot decide this"). Invalid claims, by contrast, reject the order
 * so escrow refunds.
 */
const SymbolSchema = z
  .string()
  .trim()
  .regex(/^\$?[a-zA-Z0-9]{1,20}$/, "token symbol like AIXBT or $BNKR");

const DaySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "UTC day formatted YYYY-MM-DD");

const ChainSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]{2,30}$/, "DefiLlama chain slug like base or solana");

export const VerifyInputSchema = z.discriminatedUnion("family", [
  z.object({
    family: z.literal("mcap_at_least"),
    token: SymbolSchema,
    lineUsd: z.number().positive().finite(),
    onDay: DaySchema.optional(),
  }),
  z.object({
    family: z.literal("price_at_least"),
    token: SymbolSchema,
    lineUsd: z.number().positive().finite(),
    onDay: DaySchema.optional(),
  }),
  z.object({
    family: z.literal("mcap_flip"),
    token: SymbolSchema,
    versusToken: SymbolSchema,
  }),
  z.object({
    family: z.literal("chain_dex_volume_7d"),
    chain: ChainSchema,
    versusChain: ChainSchema,
  }),
]);

export function createVerifyService(hunch: HunchApi): ServiceHandler {
  return {
    name: "verify",
    async handle(ctx: ServiceContext): Promise<Record<string, unknown>> {
      const parsed = VerifyInputSchema.safeParse(ctx.input);
      if (!parsed.success) {
        throw new Error(
          `invalid verify claim: ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "claim"}: ${i.message}`)
            .join("; ")}. Whitelisted families: mcap_at_least, price_at_least (optional onDay YYYY-MM-DD), mcap_flip, chain_dex_volume_7d`,
        );
      }

      let read;
      try {
        read = await hunch.verifyClaim(parsed.data as HunchVerifyClaim);
      } catch (error) {
        if (error instanceof HunchApiError && error.status === 422) {
          // Caller error (unvetted token / malformed claim) → reject → refund.
          throw new Error(
            `claim rejected by the resolver stack: ${error.message}. Only vetted tokens are verifiable — see the docs for the supported set.`,
          );
        }
        throw error;
      }

      const result = read.data;
      return {
        service: "verify",
        status: "ok",
        verdict: result.verdict,
        claim: result.claim,
        reading: result.reading,
        method: result.method,
        ...(result.reason ? { reason: result.reason } : {}),
        provenance: [
          {
            source: "playhunch.xyz partner verify (production resolver stack)",
            url: read.url,
            readAt: read.readAt,
          },
          ...result.provenance,
        ],
        asOf: ctx.clock.now().toISOString(),
      };
    },
  };
}
