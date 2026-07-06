import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import {
  AllowlistEntrySchema,
  type AllowlistEntry,
  type BuyerBudget,
} from "./core/signal-buyer/policy.js";

/** Load .env from the package dir and the repo root (first hit wins per key). */
export function loadEnv(): void {
  for (const candidate of [".env", "../../.env"]) {
    const path = resolve(process.cwd(), candidate);
    if (existsSync(path)) loadDotenv({ path });
  }
}

const EnvSchema = z.object({
  CROO_API_URL: z.string().url().default("https://api.croo.network"),
  CROO_WS_URL: z.string().url().default("wss://api.croo.network/ws"),
  CROO_SDK_KEY: z.string().startsWith("croo_sk_"),
  HUNCH_API_URL: z.string().url().default("https://www.playhunch.xyz"),
  /**
   * JSON map of CAP serviceId → handler name, e.g. {"svc_123":"echo"}.
   * Service ids come from the Store dashboard after listing.
   */
  ORACLE_SERVICE_MAP: z.string().default("{}"),
  /** S0 spike only: answer ANY service id with the echo handler. */
  ORACLE_ECHO_ALL: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  // ── S10 hardening knobs ──────────────────────────────────────────────────
  /** Bounded retries for a transient deliver failure before deferring to the sweep. */
  ORACLE_DELIVER_RETRIES: z.coerce.number().int().nonnegative().default(3),
  /** Base backoff (ms) between deliver retries (exponential). */
  ORACLE_RETRY_BASE_MS: z.coerce.number().int().positive().default(250),
  /** How often (ms) to run the WS-drop safety-net sweep. */
  ORACLE_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  /** If set, expose a JSON /healthz + /status server on this port. */
  ORACLE_HEALTH_PORT: z.coerce.number().int().positive().optional(),

  // ── S11 track-record scorecard ───────────────────────────────────────────
  /**
   * If set, enables the forecast track record: delivered forecasts are appended
   * to this append-only JSONL ledger, the `scorecard` service is served, and a
   * periodic settle sweep scores resolved markets. Unset → the desk behaves
   * exactly as before (no recording), so S11 is strictly additive.
   */
  ORACLE_LEDGER_PATH: z.string().optional(),
  /** How often (ms) to score resolved forecasts against the live resolver. */
  ORACLE_SETTLE_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  /**
   * Deterministic per-order cap (USD) on the stake a `hedge-quote` plan may
   * recommend. The LLM never sizes a hedge — this cap does; over-cap requests
   * are clamped, never silently honoured. Non-custodial, so this bounds the
   * plan we hand back, not the desk's own money.
   */
  HEDGE_QUOTE_MAX_STAKE_USD: z.coerce.number().positive().default(10),

  // ── Signal-buyer (S8): the requester side ────────────────────────────────
  /** Requester agent key (an agent cannot hire itself → separate from CROO_SDK_KEY). */
  CROO_REQUESTER_SDK_KEY: z.string().startsWith("croo_sk_").optional(),
  /** Master switch: without it the buyer only ever dry-runs (moves no money). */
  SIGNAL_BUYER_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  /** JSON array of human-curated {serviceId,label,category?,maxPriceUsd?,...}. */
  SIGNAL_BUYER_ALLOWLIST: z.string().default("[]"),
  SIGNAL_BUYER_DAILY_CAP_USD: z.coerce.number().nonnegative().default(5),
  SIGNAL_BUYER_MAX_PRICE_USD: z.coerce.number().positive().default(1),
  SIGNAL_BUYER_PER_SERVICE_CAP_USD: z.coerce.number().positive().optional(),
});

export type OracleEnv = z.infer<typeof EnvSchema>;

export function readEnv(): OracleEnv {
  loadEnv();
  return EnvSchema.parse(process.env);
}

export function parseServiceMap(raw: string): Record<string, string> {
  const parsed: unknown = JSON.parse(raw);
  const out = z.record(z.string()).parse(parsed);
  return out;
}

/** Parse + validate the human-curated signal-buyer allowlist. */
export function parseAllowlist(raw: string): AllowlistEntry[] {
  const parsed: unknown = JSON.parse(raw);
  return z.array(AllowlistEntrySchema).parse(parsed);
}

/** Build the buyer budget from env (per-service cap is optional). */
export function buyerBudgetFromEnv(env: OracleEnv): BuyerBudget {
  return {
    dailyCapUsd: env.SIGNAL_BUYER_DAILY_CAP_USD,
    maxPriceUsd: env.SIGNAL_BUYER_MAX_PRICE_USD,
    ...(env.SIGNAL_BUYER_PER_SERVICE_CAP_USD !== undefined
      ? { perServiceDailyCapUsd: env.SIGNAL_BUYER_PER_SERVICE_CAP_USD }
      : {}),
  };
}
