import type { Person, Session, StoredMemory } from "./memory/types.ts";

/** The shapes the browser receives. Kept in one place so the panels agree. */

export interface ApiError {
  code: string;
  message: string;
  provider?: string;
  model?: string;
  status?: number | null;
}

export interface PayloadView {
  endpoint: string;
  model: string;
  body: unknown;
  stats: {
    memoriesIncluded: number;
    transcriptMessages: number;
    systemInstructionChars: number;
    totalChars: number;
  };
}

export interface RankedView {
  id: string;
  statement: string;
  score: number;
  reason: string;
}

export interface TurnReport {
  decisions: Array<{ kind: string; description: string }>;
  extraction: { ok: true; candidates: number } | { ok: false; code: string; message: string };
  retrieval: {
    strategy: "all" | "ranked";
    activeCount: number;
    limit: number;
    selected: RankedView[];
    heldBack: RankedView[];
  };
}

export interface ChatResponse extends TurnReport {
  reply: string;
  memories: StoredMemory[];
  payload: PayloadView;
}

export interface SessionResponse {
  person: Person;
  session: Session;
  memories: StoredMemory[];
  turns: Array<{ id: string; role: "user" | "model"; text: string; createdAt: string }>;
  lastPayload: PayloadView | null;
}

export type Readiness = "ok" | "unconfigured" | "unreachable";

/**
 * Lives here rather than in the health route so that a client component can
 * describe the report without importing anything from a server route. An
 * `import type` is erased at build time, but one careless edit turning it into
 * a value import would drag the database client into the browser bundle.
 */
export interface HealthReport {
  ready: boolean;
  database: { status: Readiness; detail: string };
  models: { chat: string; extraction: string; keyPresent: boolean };
}
