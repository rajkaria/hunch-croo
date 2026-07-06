/** Small runtime ports so core stays pure and testable. */

export interface Clock {
  now(): Date;
}

export interface OracleLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export const systemClock: Clock = { now: () => new Date() };

/** Injectable sleep so long-poll loops (watch) test instantly with fakes. */
export interface Sleeper {
  sleep(ms: number): Promise<void>;
}

export const systemSleeper: Sleeper = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export const consoleLogger: OracleLogger = {
  info: (m, meta) => console.log(`[oracle] ${m}`, meta ?? ""),
  warn: (m, meta) => console.warn(`[oracle] ${m}`, meta ?? ""),
  error: (m, meta) => console.error(`[oracle] ${m}`, meta ?? ""),
};
