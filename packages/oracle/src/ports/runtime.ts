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

/** Matches a CROO SDK key anywhere it might surface (bare, in a URL, in an
 *  error string). Global so every occurrence in a value is masked. */
const SECRET_PATTERN = /croo_sk_[a-zA-Z0-9]+/g;

/**
 * Deep-mask CROO SDK keys in any value before it reaches a log sink. Strings
 * are masked directly; objects/arrays are walked. A defence-in-depth net: the
 * SDK redacts its own logs, but our provider loop also logs `String(error)`,
 * which can carry the WS URL (with the key) from a connection failure.
 */
export function redactSecrets(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return value.replace(SECRET_PATTERN, "croo_sk_***");
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((v) => redactSecrets(v, seen));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactSecrets(v, seen);
    return out;
  }
  return value;
}

/** Wrap a logger so every message + meta is redacted at the boundary. */
export function redactingLogger(inner: OracleLogger): OracleLogger {
  const wrap =
    (fn: (m: string, meta?: Record<string, unknown>) => void) =>
    (message: string, meta?: Record<string, unknown>) =>
      fn(
        redactSecrets(message) as string,
        meta === undefined
          ? undefined
          : (redactSecrets(meta) as Record<string, unknown>),
      );
  return {
    info: wrap(inner.info.bind(inner)),
    warn: wrap(inner.warn.bind(inner)),
    error: wrap(inner.error.bind(inner)),
  };
}

const rawConsoleLogger: OracleLogger = {
  info: (m, meta) => console.log(`[oracle] ${m}`, meta ?? ""),
  warn: (m, meta) => console.warn(`[oracle] ${m}`, meta ?? ""),
  error: (m, meta) => console.error(`[oracle] ${m}`, meta ?? ""),
};

/** Console logger with secret redaction always on — the worker's default sink. */
export const consoleLogger: OracleLogger = redactingLogger(rawConsoleLogger);
