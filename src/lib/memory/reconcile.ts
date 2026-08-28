import { isSingleValued, normaliseAttribute } from "./attributes.ts";
import { fingerprint } from "./fingerprint.ts";
import type { CandidateFact, Decision, StoredMemory } from "./types.ts";

/**
 * reconcile() is the interesting part of this project.
 *
 * It takes what is already known about a person and what the extractor just
 * proposed, and returns what should happen. It performs no writes and touches
 * no clock or random source of its own, which is the only reason the dedupe and
 * supersede rules can be tested exhaustively without a database or a live model.
 */

export interface ReconcileContext {
  personId: string;
  sessionId: string;
  /** ISO timestamp for this batch. Injected so tests are deterministic. */
  now: string;
  /** Injected so tests are deterministic. */
  newId: () => string;
}

/**
 * Collapse candidates that are the same fact before any of them are compared to
 * storage. One message saying "I live in Cebu, I really do live in Cebu" should
 * count as one mention, not two, and should certainly not supersede itself.
 */
function dedupeCandidates(candidates: CandidateFact[]): CandidateFact[] {
  const seen = new Set<string>();
  const out: CandidateFact[] = [];
  for (const raw of candidates) {
    const attribute = normaliseAttribute(raw.attribute);
    const statement = raw.statement.trim().replace(/\s+/g, " ");
    if (statement === "") continue;
    const fp = fingerprint(attribute, statement);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push({ attribute, statement });
  }
  return out;
}

export function reconcile(
  existing: StoredMemory[],
  candidates: CandidateFact[],
  ctx: ReconcileContext,
): Decision[] {
  // Work against a mutable copy so that decisions made earlier in this batch are
  // visible to decisions made later in it. Without this, two candidates for the
  // same single valued attribute in one message would both insert.
  const working: StoredMemory[] = existing
    .filter((m) => m.status === "active")
    .map((m) => ({ ...m }));

  const decisions: Decision[] = [];

  for (const candidate of dedupeCandidates(candidates)) {
    const { attribute, statement } = candidate;
    const fp = fingerprint(attribute, statement);

    const identical = working.find((m) => m.fingerprint === fp);
    if (identical) {
      // Idempotent write. The fact is already held, so nothing new is stored.
      // The mention is still recorded, because "you have told me this three
      // times" is true and worth being able to show.
      identical.mentionCount += 1;
      identical.lastSeenAt = ctx.now;
      decisions.push({
        kind: "duplicate",
        candidate,
        existingId: identical.id,
        mentionCount: identical.mentionCount,
        lastSeenAt: identical.lastSeenAt,
      });
      continue;
    }

    const sameAttribute = working.filter((m) => m.attribute === attribute);
    const id = ctx.newId();

    if (sameAttribute.length > 0 && isSingleValued(attribute)) {
      // The person has changed their mind, or corrected us. The old value is
      // not deleted, it is marked superseded and keeps pointing at what replaced
      // it, so the panel can show the history rather than just the winner.
      const newest = sameAttribute.reduce((a, b) =>
        a.createdAt >= b.createdAt ? a : b,
      );
      const memory: StoredMemory = {
        id,
        personId: ctx.personId,
        attribute,
        statement,
        fingerprint: fp,
        status: "active",
        lineageId: newest.lineageId,
        createdAt: ctx.now,
        lastSeenAt: ctx.now,
        mentionCount: 1,
        sourceSessionId: ctx.sessionId,
        supersededById: null,
        supersededAt: null,
      };
      const supersedes = sameAttribute.map((m) => ({
        id: m.id,
        statement: m.statement,
      }));
      for (const old of sameAttribute) {
        old.status = "superseded";
        old.supersededById = id;
        old.supersededAt = ctx.now;
      }
      working.push(memory);
      decisions.push({ kind: "supersede", candidate, memory, supersedes });
      continue;
    }

    const memory: StoredMemory = {
      id,
      personId: ctx.personId,
      attribute,
      statement,
      fingerprint: fp,
      status: "active",
      lineageId: id,
      createdAt: ctx.now,
      lastSeenAt: ctx.now,
      mentionCount: 1,
      sourceSessionId: ctx.sessionId,
      supersededById: null,
      supersededAt: null,
    };
    working.push(memory);
    decisions.push({
      // Same write either way. The two names exist so the UI can say "kept
      // alongside what you already told me" instead of "stored", which is the
      // difference a person actually cares about.
      kind: sameAttribute.length > 0 ? "append" : "store",
      candidate,
      memory,
    });
  }

  return decisions;
}

/** Human readable one liner for each decision. Used in the UI and in tests. */
export function describeDecision(decision: Decision): string {
  switch (decision.kind) {
    case "store":
      return `Stored "${decision.memory.statement}"`;
    case "append":
      return `Added "${decision.memory.statement}" alongside what was already known about ${decision.memory.attribute}`;
    case "supersede":
      return `Replaced ${decision.supersedes
        .map((s) => `"${s.statement}"`)
        .join(", ")} with "${decision.memory.statement}"`;
    case "duplicate":
      return `Already knew "${decision.candidate.statement}", mention ${decision.mentionCount}, nothing new stored`;
  }
}
