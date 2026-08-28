import { normaliseStatement } from "./fingerprint.ts";
import type { StoredMemory } from "./types.ts";

/**
 * Retrieval, kept deliberately small and legible.
 *
 * At demo scale a person holds a few dozen facts, so the honest thing is to
 * send all of them and say so. Ranking only starts to matter once there are
 * more facts than fit in the budget, and at that point what got left out is
 * exactly what a sceptic should be shown. So this returns both halves.
 *
 * No embeddings. A vector index here would add a service, a cost and a failure
 * mode without changing a single answer at this size, and it would make the
 * payload panel harder to read rather than easier.
 */

const STOPWORDS = new Set([
  "a", "an", "and", "any", "are", "as", "at", "be", "but", "by", "can", "did",
  "do", "does", "for", "from", "had", "has", "have", "how", "i", "in", "is",
  "it", "me", "my", "no", "not", "of", "on", "or", "so", "that", "the", "them",
  "they", "this", "to", "was", "we", "what", "when", "where", "which", "who",
  "why", "will", "with", "you", "your",
]);

function contentTokens(text: string): Set<string> {
  return new Set(
    normaliseStatement(text)
      .split(" ")
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

export interface RankedMemory {
  memory: StoredMemory;
  score: number;
  /** Why this scored the way it did, in words a non engineer can check. */
  reason: string;
}

export interface Retrieval {
  selected: RankedMemory[];
  heldBack: RankedMemory[];
  /** "all" means nothing was filtered out, which is the usual case. */
  strategy: "all" | "ranked";
  limit: number;
  activeCount: number;
}

export function scoreMemory(memory: StoredMemory, queryTokens: Set<string>): RankedMemory {
  const tokens = contentTokens(`${memory.attribute} ${memory.statement}`);
  let overlap = 0;
  for (const token of tokens) if (queryTokens.has(token)) overlap += 1;

  // Overlap dominates. Mentions break ties, on the reasoning that a fact the
  // person keeps repeating matters more to them than one said once in passing.
  const mentionBonus = Math.min(memory.mentionCount - 1, 3) * 0.1;
  const score = overlap + mentionBonus;

  const reason =
    overlap > 0
      ? `${overlap} word${overlap === 1 ? "" : "s"} in common with the question`
      : "no words in common with the question";
  return { memory, score, reason };
}

export function retrieve(
  memories: StoredMemory[],
  query: string,
  limit = 24,
): Retrieval {
  const active = memories.filter((m) => m.status === "active");
  const queryTokens = contentTokens(query);
  const ranked = active
    .map((m) => scoreMemory(m, queryTokens))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Newest first when scores tie, so a correction outranks what it replaced
      // if both somehow end up in the running.
      return b.memory.createdAt.localeCompare(a.memory.createdAt);
    });

  if (active.length <= limit) {
    return {
      selected: ranked,
      heldBack: [],
      strategy: "all",
      limit,
      activeCount: active.length,
    };
  }

  return {
    selected: ranked.slice(0, limit),
    heldBack: ranked.slice(limit),
    strategy: "ranked",
    limit,
    activeCount: active.length,
  };
}
