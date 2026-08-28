import type { Decision, Person, Session, StoredMemory, Turn, TurnRole } from "../memory/types.ts";

/**
 * Everything the app needs from storage, and nothing more.
 *
 * There are two implementations behind this: Postgres for real use, and an
 * in-memory one for tests. They are held to the same contract test, so the
 * offline suite is testing the rules the deployed app actually runs under
 * rather than a convenient fiction.
 */

export interface NewTurn {
  id: string;
  sessionId: string;
  role: TurnRole;
  text: string;
  createdAt: string;
  /** Only set on model turns. The exact body that was sent to the provider. */
  payload?: unknown;
}

export interface Store {
  ensurePerson(handle: string): Promise<Person>;
  getPerson(id: string): Promise<Person | null>;
  createSession(personId: string): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  endSession(id: string): Promise<Session | null>;

  /** Every memory for a person, active and superseded, newest first. */
  listMemories(personId: string): Promise<StoredMemory[]>;

  /**
   * Writes the decisions reconcile() made, as one unit. Either the supersede and
   * the insert both land or neither does, otherwise a crash between them leaves
   * a person with two contradictory active facts.
   */
  applyDecisions(decisions: Decision[]): Promise<void>;

  /**
   * Deletes a memory and everything it replaced. Genuinely deletes: no flag, no
   * tombstone, nothing left to un-hide. A privacy control that only hides things
   * is a lie, so the row goes.
   */
  deleteLineage(personId: string, lineageId: string): Promise<{ deleted: number }>;

  appendTurn(turn: NewTurn): Promise<void>;
  listTurns(sessionId: string): Promise<Turn[]>;
  /** The payload from the most recent model turn, so the proof panel survives a reload. */
  lastPayload(sessionId: string): Promise<unknown | null>;

  close(): Promise<void>;
}
