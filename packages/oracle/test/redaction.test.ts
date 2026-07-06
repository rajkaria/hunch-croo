import { describe, expect, it } from "vitest";
import {
  redactSecrets,
  redactingLogger,
  type OracleLogger,
} from "../src/ports/runtime.js";

const KEY = "croo_sk_abc123DEF456";

describe("redactSecrets", () => {
  it("masks a bare SDK key", () => {
    expect(redactSecrets(KEY)).toBe("croo_sk_***");
  });

  it("masks a key embedded in a WS URL", () => {
    expect(
      redactSecrets(`connecting to wss://api.croo.network/ws?key=${KEY}`),
    ).toBe("connecting to wss://api.croo.network/ws?key=croo_sk_***");
  });

  it("masks keys deep inside objects and arrays", () => {
    const out = redactSecrets({
      url: `wss://x/ws?key=${KEY}`,
      nested: { list: [`${KEY}`, "safe"] },
    }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain("abc123DEF456");
    expect((out.nested as { list: string[] }).list[1]).toBe("safe");
  });

  it("leaves non-secret values untouched, including non-strings", () => {
    expect(redactSecrets("nothing secret here")).toBe("nothing secret here");
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBe(null);
    expect(redactSecrets(undefined)).toBe(undefined);
  });
});

describe("redactingLogger", () => {
  function capturing() {
    const calls: Array<{ level: string; msg: string; meta?: unknown }> = [];
    const inner: OracleLogger = {
      info: (msg, meta) => calls.push({ level: "info", msg, meta }),
      warn: (msg, meta) => calls.push({ level: "warn", msg, meta }),
      error: (msg, meta) => calls.push({ level: "error", msg, meta }),
    };
    return { inner, calls };
  }

  it("redacts the message and forwards to the inner logger", () => {
    const { inner, calls } = capturing();
    redactingLogger(inner).info(`booted with ${KEY}`);
    expect(calls[0]).toMatchObject({ level: "info", msg: "booted with croo_sk_***" });
  });

  it("redacts secrets hiding in meta (e.g. String(error) with the WS URL)", () => {
    const { inner, calls } = capturing();
    redactingLogger(inner).error("event handling failed", {
      error: `Error: connect wss://api.croo.network/ws?key=${KEY} refused`,
    });
    expect(JSON.stringify(calls[0]!.meta)).not.toContain("abc123DEF456");
    expect(JSON.stringify(calls[0]!.meta)).toContain("croo_sk_***");
  });
});

describe("redactSecrets cycle safety", () => {
  it("does not blow the stack on a circular structure", () => {
    const cyclic: Record<string, unknown> = { key: KEY };
    cyclic.self = cyclic;
    const out = redactSecrets(cyclic) as Record<string, unknown>;
    expect(out.key).toBe("croo_sk_***");
    // the cycle is broken, not infinitely walked
    expect(out.self).toBeDefined();
  });
});
