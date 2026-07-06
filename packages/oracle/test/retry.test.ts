import { describe, expect, it } from "vitest";
import { retry } from "../src/core/retry.js";
import type { Sleeper } from "../src/ports/runtime.js";

/** Records every requested delay and resolves instantly (no real waiting). */
function recordingSleeper(): Sleeper & { delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms) => {
      delays.push(ms);
    },
  };
}

describe("retry", () => {
  it("returns immediately on first success without sleeping", async () => {
    const sleeper = recordingSleeper();
    let calls = 0;
    const result = await retry(
      async () => {
        calls += 1;
        return "ok";
      },
      { retries: 3, baseMs: 10, sleeper },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(1);
    expect(sleeper.delays).toEqual([]);
  });

  it("retries a transient failure and succeeds, backing off exponentially", async () => {
    const sleeper = recordingSleeper();
    let calls = 0;
    const result = await retry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("transient");
        return "recovered";
      },
      { retries: 3, baseMs: 10, sleeper },
    );
    expect(result).toBe("recovered");
    expect(calls).toBe(3);
    // two failures → two backoffs, exponential: 10, 20
    expect(sleeper.delays).toEqual([10, 20]);
  });

  it("throws the last error after exhausting retries", async () => {
    const sleeper = recordingSleeper();
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls += 1;
          throw new Error(`fail-${calls}`);
        },
        { retries: 2, baseMs: 5, sleeper },
      ),
    ).rejects.toThrow("fail-3");
    // retries:2 → 3 total attempts, 2 backoffs
    expect(calls).toBe(3);
    expect(sleeper.delays).toEqual([5, 10]);
  });

  it("does not retry when shouldRetry rejects the error (terminal errors)", async () => {
    const sleeper = recordingSleeper();
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls += 1;
          throw new Error("permanent");
        },
        {
          retries: 5,
          baseMs: 5,
          sleeper,
          shouldRetry: () => false,
        },
      ),
    ).rejects.toThrow("permanent");
    expect(calls).toBe(1);
    expect(sleeper.delays).toEqual([]);
  });

  it("reports each retry attempt via onRetry", async () => {
    const sleeper = recordingSleeper();
    const attempts: number[] = [];
    let calls = 0;
    await retry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("x");
        return 1;
      },
      {
        retries: 3,
        baseMs: 1,
        sleeper,
        onRetry: (attempt) => attempts.push(attempt),
      },
    );
    expect(attempts).toEqual([1, 2]);
  });
});
