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

export const consoleLogger: OracleLogger = {
  info: (m, meta) => console.log(`[oracle] ${m}`, meta ?? ""),
  warn: (m, meta) => console.warn(`[oracle] ${m}`, meta ?? ""),
  error: (m, meta) => console.error(`[oracle] ${m}`, meta ?? ""),
};
