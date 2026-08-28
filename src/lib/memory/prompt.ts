import type { StoredMemory, Turn } from "./types.ts";

/**
 * Builds the exact request body sent to the model, and nothing else.
 *
 * This is a pure function on purpose. The panel that proves no transcript is
 * being smuggled in shows the object this returns, byte for byte, so it must be
 * impossible for anything to be added between building it and sending it.
 */

export interface GeminiPart {
  text: string;
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface GeminiRequestBody {
  systemInstruction: { parts: GeminiPart[] };
  contents: GeminiContent[];
  generationConfig: Record<string, unknown>;
}

export interface PayloadStats {
  /** Facts pulled out of storage and written into the system instruction. */
  memoriesIncluded: number;
  /**
   * Messages carried over from earlier in THIS session. In a fresh session this
   * is zero, which is the number the whole demo turns on.
   */
  transcriptMessages: number;
  systemInstructionChars: number;
  totalChars: number;
}

export interface BuiltPayload {
  body: GeminiRequestBody;
  stats: PayloadStats;
}

export const BASE_INSTRUCTIONS = [
  "You are Recall, a demonstration of a chat assistant whose memory outlives the session it was told something in.",
  "",
  "Everything you know about this person is in the KNOWN FACTS block below. It was extracted from earlier messages and stored in a database. You have no other memory of them, and no access to any earlier conversation.",
  "",
  "Rules:",
  "1. Never invent a fact about the person. If you were not told it, say plainly that it is not something you have been told.",
  "2. If the KNOWN FACTS block is empty, say you do not know anything about them yet and invite them to tell you something.",
  "3. Each fact says which session it was stored in. A fact marked THIS SESSION was told to you a moment ago, so never describe it as something you remember from an earlier conversation. A fact marked EARLIER SESSION was read out of the database when this session began, and saying so is welcome.",
  "4. Keep replies to two or three sentences unless asked for more.",
  "5. Do not use em dashes. Use full stops, commas and the word and.",
].join("\n");

/**
 * Provenance is written into every fact, and the current session is called out
 * explicitly.
 *
 * Without this the model cheerfully says "I remember you telling me in an
 * earlier session" about a fact extracted from the message it is replying to,
 * which is both false and the exact thing a sceptic is watching for. The code
 * knows which session a fact came from, so the model is told rather than left
 * to guess.
 */
function formatMemory(memory: StoredMemory, currentSessionId: string): string {
  const origin =
    memory.sourceSessionId === currentSessionId
      ? "THIS SESSION, you were told this a moment ago"
      : `EARLIER SESSION ${memory.sourceSessionId.slice(0, 8) || "unknown"}, stored ${memory.createdAt.slice(0, 10)}`;
  const mentions =
    memory.mentionCount > 1 ? `, told to you ${memory.mentionCount} times` : "";
  return `- [${memory.attribute}] ${memory.statement} (${origin}${mentions})`;
}

export function buildMemoryBlock(
  handle: string,
  memories: StoredMemory[],
  activeCount: number,
  currentSessionId: string,
): string {
  if (memories.length === 0) {
    return `KNOWN FACTS about ${handle}: none. Nothing has been stored about this person yet.`;
  }
  const header =
    memories.length === activeCount
      ? `KNOWN FACTS about ${handle} (${activeCount} held, all of them included):`
      : `KNOWN FACTS about ${handle} (${activeCount} held, the ${memories.length} most relevant included):`;
  return [header, ...memories.map((m) => formatMemory(m, currentSessionId))].join("\n");
}

export interface PayloadInput {
  handle: string;
  memories: StoredMemory[];
  activeCount: number;
  /** Earlier turns in the current session only. Empty in a new session. */
  transcript: Turn[];
  userMessage: string;
  /** Used to tell facts learned a moment ago apart from facts genuinely recalled. */
  sessionId: string;
}

export function buildPayload(input: PayloadInput): BuiltPayload {
  const systemText = `${BASE_INSTRUCTIONS}\n\n${buildMemoryBlock(
    input.handle,
    input.memories,
    input.activeCount,
    input.sessionId,
  )}`;

  const contents: GeminiContent[] = [
    ...input.transcript.map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }],
    })),
    { role: "user" as const, parts: [{ text: input.userMessage }] },
  ];

  const body: GeminiRequestBody = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 600,
      // Flash thinks by default. Nothing here needs it, and turning it off keeps
      // the demo responsive for someone clicking a link out of curiosity.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const totalChars =
    systemText.length +
    contents.reduce((sum, c) => sum + c.parts[0].text.length, 0);

  return {
    body,
    stats: {
      memoriesIncluded: input.memories.length,
      transcriptMessages: input.transcript.length,
      systemInstructionChars: systemText.length,
      totalChars,
    },
  };
}
