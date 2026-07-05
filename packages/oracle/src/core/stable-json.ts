/**
 * Deterministic JSON serialization: object keys sorted recursively so the same
 * logical deliverable always produces byte-identical text — and therefore the
 * same keccak256 content hash CAP writes on-chain. Redelivering an order MUST
 * reproduce the exact bytes (idempotency invariant).
 */

type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

function sortValue(value: unknown): Json {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(sortValue);
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(`stable-json: non-finite number ${value}`);
      }
      return value;
    case "object": {
      const out: { [key: string]: Json } = {};
      for (const key of Object.keys(value as object).sort()) {
        const v = (value as Record<string, unknown>)[key];
        if (v === undefined) continue;
        out[key] = sortValue(v);
      }
      return out;
    }
    default:
      throw new Error(`stable-json: unsupported type ${typeof value}`);
  }
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}
