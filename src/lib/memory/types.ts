/**
 * The vocabulary of the memory layer.
 *
 * A "candidate" is something the extraction model claims it found in a user
 * message. Nothing is trusted until it has been through reconcile(), which is
 * where dedupe and supersede are decided.
 */

export type MemoryStatus = "active" | "superseded";

/** What the extractor proposes. Not yet stored, not yet trusted. */
export interface CandidateFact {
  /** Normalised slug naming the dimension of the person this is about. */
  attribute: string;
  /** Short self contained third person statement, e.g. "Lives in Cebu". */
  statement: string;
}

export interface StoredMemory {
  id: string;
  personId: string;
  attribute: string;
  statement: string;
  /** Normalised form of attribute plus statement. Dedupe key. */
  fingerprint: string;
  status: MemoryStatus;
  /**
   * Groups a fact together with every fact it replaced. Deleting a memory
   * deletes its whole lineage, so "forgetting" cannot leave the old value
   * sitting in the table pretending to be history.
   */
  lineageId: string;
  createdAt: string;
  lastSeenAt: string;
  /** How many times this exact fact has been stated. Idempotency made visible. */
  mentionCount: number;
  sourceSessionId: string;
  supersededById: string | null;
  supersededAt: string | null;
}

/**
 * What reconcile() decided to do about one candidate. These are returned rather
 * than executed so the decision can be unit tested with no database, and so the
 * UI can explain what happened to the user in the same words the code used.
 */
export type Decision =
  | { kind: "store"; candidate: CandidateFact; memory: StoredMemory }
  | { kind: "append"; candidate: CandidateFact; memory: StoredMemory }
  | {
      kind: "supersede";
      candidate: CandidateFact;
      memory: StoredMemory;
      /**
       * Every active memory this one replaces. Normally exactly one, but the
       * invariant "a single valued attribute holds one active value" is
       * enforced here rather than assumed, so a table that has somehow drifted
       * gets repaired on the next mention instead of quietly keeping two
       * contradictory answers alive.
       */
      supersedes: Array<{ id: string; statement: string }>;
    }
  | {
      kind: "duplicate";
      candidate: CandidateFact;
      existingId: string;
      mentionCount: number;
      lastSeenAt: string;
    };

export interface Person {
  id: string;
  handle: string;
  createdAt: string;
}

export interface Session {
  id: string;
  personId: string;
  startedAt: string;
  endedAt: string | null;
}

export type TurnRole = "user" | "model";

export interface Turn {
  id: string;
  sessionId: string;
  role: TurnRole;
  text: string;
  createdAt: string;
}
