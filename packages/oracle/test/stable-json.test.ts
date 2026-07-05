import { describe, expect, it } from "vitest";
import { stableStringify } from "../src/core/stable-json.js";

describe("stableStringify", () => {
  it("sorts keys recursively", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}',
    );
  });

  it("is order-insensitive: same logical value → identical bytes", () => {
    const one = stableStringify({ x: 1, y: [true, null, "s"], z: { a: 1 } });
    const two = stableStringify({ z: { a: 1 }, y: [true, null, "s"], x: 1 });
    expect(one).toBe(two);
  });

  it("drops undefined values and keeps nulls", () => {
    expect(stableStringify({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("throws on non-finite numbers rather than emitting null silently", () => {
    expect(() => stableStringify({ a: Number.NaN })).toThrow();
    expect(() => stableStringify({ a: Infinity })).toThrow();
  });

  it("is stable across repeated serialization (idempotent redelivery bytes)", () => {
    const payload = {
      service: "echo",
      echoed: { question: "will it clear?" },
      asOf: "2026-07-06T00:00:00.000Z",
    };
    const first = stableStringify(payload);
    for (let i = 0; i < 100; i += 1) {
      expect(stableStringify(JSON.parse(first))).toBe(first);
    }
  });
});
