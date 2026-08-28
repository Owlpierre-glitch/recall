import type { Decision, Person, Session, StoredMemory, Turn } from "../memory/types.ts";
import type { NewTurn, Store } from "./types.ts";

/**
 * The in-memory implementation. Used by the test suite so that dedupe,
 * supersede and delete can be verified with one command and no services
 * running. It is held to the same contract test as the Postgres one.
 */
export class InMemoryStore implements Store {
  private people: Person[] = [];
  private sessions: Session[] = [];
  private memories: StoredMemory[] = [];
  private turns: Array<Turn & { payload?: unknown }> = [];
  private clock: () => string;
  private ids: () => string;

  constructor(options: { now?: () => string; newId?: () => string } = {}) {
    this.clock = options.now ?? (() => new Date().toISOString());
    this.ids = options.newId ?? (() => crypto.randomUUID());
  }

  async ensurePerson(handle: string): Promise<Person> {
    const key = handle.trim().toLowerCase();
    const found = this.people.find((p) => p.handle.toLowerCase() === key);
    if (found) return { ...found };
    const person: Person = { id: this.ids(), handle: handle.trim(), createdAt: this.clock() };
    this.people.push(person);
    return { ...person };
  }

  async getPerson(id: string): Promise<Person | null> {
    const found = this.people.find((p) => p.id === id);
    return found ? { ...found } : null;
  }

  async createSession(personId: string): Promise<Session> {
    const session: Session = {
      id: this.ids(),
      personId,
      startedAt: this.clock(),
      endedAt: null,
    };
    this.sessions.push(session);
    return { ...session };
  }

  async getSession(id: string): Promise<Session | null> {
    const found = this.sessions.find((s) => s.id === id);
    return found ? { ...found } : null;
  }

  async endSession(id: string): Promise<Session | null> {
    const found = this.sessions.find((s) => s.id === id);
    if (!found) return null;
    found.endedAt = found.endedAt ?? this.clock();
    return { ...found };
  }

  async listMemories(personId: string): Promise<StoredMemory[]> {
    return this.memories
      .filter((m) => m.personId === personId)
      .map((m) => ({ ...m }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async applyDecisions(decisions: Decision[]): Promise<void> {
    for (const decision of decisions) {
      if (decision.kind === "duplicate") {
        const target = this.memories.find((m) => m.id === decision.existingId);
        if (target) {
          target.mentionCount = decision.mentionCount;
          target.lastSeenAt = decision.lastSeenAt;
        }
        continue;
      }
      if (decision.kind === "supersede") {
        for (const old of decision.supersedes) {
          const target = this.memories.find((m) => m.id === old.id);
          if (target) {
            target.status = "superseded";
            target.supersededById = decision.memory.id;
            target.supersededAt = decision.memory.createdAt;
          }
        }
      }
      this.memories.push({ ...decision.memory });
    }
  }

  async deleteLineage(personId: string, lineageId: string): Promise<{ deleted: number }> {
    const before = this.memories.length;
    const doomed = new Set(
      this.memories.filter((m) => m.personId === personId && m.lineageId === lineageId).map((m) => m.id),
    );
    this.memories = this.memories.filter((m) => !doomed.has(m.id));
    for (const m of this.memories) {
      if (m.supersededById && doomed.has(m.supersededById)) m.supersededById = null;
    }
    return { deleted: before - this.memories.length };
  }

  async appendTurn(turn: NewTurn): Promise<void> {
    this.turns.push({
      id: turn.id,
      sessionId: turn.sessionId,
      role: turn.role,
      text: turn.text,
      createdAt: turn.createdAt,
      payload: turn.payload,
    });
  }

  async listTurns(sessionId: string): Promise<Turn[]> {
    return this.turns
      .filter((t) => t.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(({ id, sessionId: s, role, text, createdAt }) => ({
        id,
        sessionId: s,
        role,
        text,
        createdAt,
      }));
  }

  async lastPayload(sessionId: string): Promise<unknown | null> {
    const withPayload = this.turns
      .filter((t) => t.sessionId === sessionId && t.payload !== undefined)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const last = withPayload.at(-1);
    return last ? last.payload : null;
  }

  async close(): Promise<void> {}
}
