import assert from "node:assert/strict";
import { fingerprint } from "../src/lib/memory/fingerprint.ts";
import type { Decision, StoredMemory } from "../src/lib/memory/types.ts";

/** Deterministic id source, so every assertion below can name exact ids. */
export function idSequence(prefix = "m"): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

export function memory(overrides: Partial<StoredMemory> & { attribute: string; statement: string }): StoredMemory {
  return {
    id: "seed",
    personId: "p1",
    status: "active",
    lineageId: "seed",
    createdAt: "2026-08-01T00:00:00.000Z",
    lastSeenAt: "2026-08-01T00:00:00.000Z",
    mentionCount: 1,
    sourceSessionId: "s-old",
    supersededById: null,
    supersededAt: null,
    ...overrides,
    // Derived last so a hand written fingerprint is never out of step with the
    // statement it is supposed to be a fingerprint of.
    fingerprint: overrides.fingerprint ?? fingerprint(overrides.attribute, overrides.statement),
  };
}

export const CTX = {
  personId: "p1",
  sessionId: "s-new",
  now: "2026-08-28T12:00:00.000Z",
};

/**
 * Narrows a Decision to one variant and asserts it at the same time, so the
 * tests stay type checked by the same `tsc` run as the app rather than being
 * excluded from it.
 */
export function asKind<K extends Decision["kind"]>(
  decision: Decision | undefined,
  kind: K,
): Extract<Decision, { kind: K }> {
  assert.ok(decision, `expected a decision, got none`);
  assert.equal(decision.kind, kind, `expected a "${kind}" decision, got "${decision.kind}"`);
  return decision as Extract<Decision, { kind: K }>;
}
