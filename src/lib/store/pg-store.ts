import postgres from "postgres";
import type { Decision, Person, Session, StoredMemory, Turn, TurnRole } from "../memory/types.ts";
import type { NewTurn, Store } from "./types.ts";

/**
 * The Postgres implementation, pointed at Supabase in production.
 *
 * `prepare: false` is the setting Supabase documents for its pooled connection
 * string, which runs transaction mode pooling where a server connection is
 * returned to the pool after every transaction.
 *
 * Worth being precise about, since this is the kind of claim that gets repeated
 * without checking: I ran the whole suite through a real pgbouncer in
 * transaction mode and could NOT force a failure with prepared statements left
 * on, with pooler side support both enabled and disabled. pgbouncer has tracked
 * and replayed prepared statements since 1.21, and postgres.js re-prepares when
 * a statement goes missing. So this stays because it is the documented safe
 * setting for a pooler and costs nothing measurable here, not because it was
 * proven load bearing. What IS verified is that everything below works through
 * transaction mode pooling.
 *
 * applyDecisions runs inside one transaction. A supersede is two writes, and a
 * crash between them would leave a person holding two contradictory facts that
 * both claim to be current.
 */

type Sql = ReturnType<typeof postgres>;

interface MemoryRow {
  id: string;
  person_id: string;
  attribute: string;
  statement: string;
  fingerprint: string;
  status: string;
  lineage_id: string;
  created_at: Date;
  last_seen_at: Date;
  mention_count: number;
  source_session_id: string | null;
  superseded_by_id: string | null;
  superseded_at: Date | null;
}

function isLocal(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toMemory(row: MemoryRow): StoredMemory {
  return {
    id: row.id,
    personId: row.person_id,
    attribute: row.attribute,
    statement: row.statement,
    fingerprint: row.fingerprint,
    status: row.status === "superseded" ? "superseded" : "active",
    lineageId: row.lineage_id,
    createdAt: iso(row.created_at) ?? "",
    lastSeenAt: iso(row.last_seen_at) ?? "",
    mentionCount: row.mention_count,
    // A deleted session must not take the memory with it, so provenance is
    // allowed to be missing rather than the row being missing.
    sourceSessionId: row.source_session_id ?? "",
    supersededById: row.superseded_by_id,
    supersededAt: iso(row.superseded_at),
  };
}

export class PostgresStore implements Store {
  private sql: Sql;

  constructor(connectionString: string) {
    this.sql = postgres(connectionString, {
      prepare: false,
      // Supabase requires TLS and postgres.js does not assume it. Defaulting to
      // off would work on a local database and fail only once deployed, which
      // is the worst time to discover it. A local host opts out instead.
      ssl: isLocal(connectionString) ? false : "require",
      max: 3,
      idle_timeout: 20,
      connect_timeout: 15,
    });
  }

  async ensurePerson(handle: string): Promise<Person> {
    const clean = handle.trim();
    const key = clean.toLowerCase();
    const rows = await this.sql<Array<{ id: string; handle: string; created_at: Date }>>`
      insert into recall_people (id, handle, handle_key)
      values (${crypto.randomUUID()}, ${clean}, ${key})
      on conflict (handle_key) do update set handle = recall_people.handle
      returning id, handle, created_at
    `;
    const row = rows[0];
    return { id: row.id, handle: row.handle, createdAt: iso(row.created_at) ?? "" };
  }

  async getPerson(id: string): Promise<Person | null> {
    const rows = await this.sql<Array<{ id: string; handle: string; created_at: Date }>>`
      select id, handle, created_at from recall_people where id = ${id}
    `;
    const row = rows[0];
    if (!row) return null;
    return { id: row.id, handle: row.handle, createdAt: iso(row.created_at) ?? "" };
  }

  async createSession(personId: string): Promise<Session> {
    const rows = await this.sql<Array<{ id: string; person_id: string; started_at: Date; ended_at: Date | null }>>`
      insert into recall_sessions (id, person_id)
      values (${crypto.randomUUID()}, ${personId})
      returning id, person_id, started_at, ended_at
    `;
    const row = rows[0];
    return {
      id: row.id,
      personId: row.person_id,
      startedAt: iso(row.started_at) ?? "",
      endedAt: iso(row.ended_at),
    };
  }

  async getSession(id: string): Promise<Session | null> {
    const rows = await this.sql<Array<{ id: string; person_id: string; started_at: Date; ended_at: Date | null }>>`
      select id, person_id, started_at, ended_at from recall_sessions where id = ${id}
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      personId: row.person_id,
      startedAt: iso(row.started_at) ?? "",
      endedAt: iso(row.ended_at),
    };
  }

  async endSession(id: string): Promise<Session | null> {
    const rows = await this.sql<Array<{ id: string; person_id: string; started_at: Date; ended_at: Date | null }>>`
      update recall_sessions
         set ended_at = coalesce(ended_at, now())
       where id = ${id}
      returning id, person_id, started_at, ended_at
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      personId: row.person_id,
      startedAt: iso(row.started_at) ?? "",
      endedAt: iso(row.ended_at),
    };
  }

  async listMemories(personId: string): Promise<StoredMemory[]> {
    const rows = await this.sql<MemoryRow[]>`
      select * from recall_memories
       where person_id = ${personId}
       order by created_at desc
    `;
    return rows.map(toMemory);
  }

  async applyDecisions(decisions: Decision[]): Promise<void> {
    if (decisions.length === 0) return;
    await this.sql.begin(async (tx) => {
      for (const decision of decisions) {
        if (decision.kind === "duplicate") {
          await tx`
            update recall_memories
               set mention_count = ${decision.mentionCount},
                   last_seen_at  = ${decision.lastSeenAt}
             where id = ${decision.existingId}
          `;
          continue;
        }

        // The new row is inserted before the rows it replaces are retired,
        // because superseded_by_id is a foreign key and cannot point at a row
        // that does not exist yet. The other order is safe against the partial
        // unique index either way: reconcile only produces a supersede when no
        // active row shares this fingerprint, so the two never collide.
        const m = decision.memory;
        await tx`
          insert into recall_memories
            (id, person_id, attribute, statement, fingerprint, status, lineage_id,
             created_at, last_seen_at, mention_count, source_session_id)
          values
            (${m.id}, ${m.personId}, ${m.attribute}, ${m.statement}, ${m.fingerprint},
             ${m.status}, ${m.lineageId}, ${m.createdAt}, ${m.lastSeenAt},
             ${m.mentionCount}, ${m.sourceSessionId})
        `;

        if (decision.kind === "supersede") {
          for (const old of decision.supersedes) {
            await tx`
              update recall_memories
                 set status           = 'superseded',
                     superseded_by_id = ${decision.memory.id},
                     superseded_at    = ${decision.memory.createdAt}
               where id = ${old.id}
            `;
          }
        }
      }
    });
  }

  async deleteLineage(personId: string, lineageId: string): Promise<{ deleted: number }> {
    const rows = await this.sql<Array<{ id: string }>>`
      delete from recall_memories
       where person_id = ${personId} and lineage_id = ${lineageId}
      returning id
    `;
    return { deleted: rows.length };
  }

  async appendTurn(turn: NewTurn): Promise<void> {
    const payload = turn.payload === undefined ? null : this.sql.json(turn.payload as never);
    await this.sql`
      insert into recall_turns (id, session_id, role, text, payload, created_at)
      values (${turn.id}, ${turn.sessionId}, ${turn.role}, ${turn.text}, ${payload}, ${turn.createdAt})
    `;
  }

  async listTurns(sessionId: string): Promise<Turn[]> {
    const rows = await this.sql<Array<{ id: string; session_id: string; role: string; text: string; created_at: Date }>>`
      select id, session_id, role, text, created_at
        from recall_turns
       where session_id = ${sessionId}
       order by created_at asc
    `;
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: (row.role === "model" ? "model" : "user") as TurnRole,
      text: row.text,
      createdAt: iso(row.created_at) ?? "",
    }));
  }

  async lastPayload(sessionId: string): Promise<unknown | null> {
    const rows = await this.sql<Array<{ payload: unknown }>>`
      select payload from recall_turns
       where session_id = ${sessionId} and payload is not null
       order by created_at desc
       limit 1
    `;
    return rows[0]?.payload ?? null;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
