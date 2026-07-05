import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

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
