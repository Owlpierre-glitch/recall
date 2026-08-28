import { NextResponse } from "next/server";
import { failure, fromThrown, isUuid } from "@/lib/api.ts";
import { CHAT_MODEL, EXTRACTION_MODEL, ProviderError, callGemini, endpointForDisplay } from "@/lib/gemini.ts";
import { ExtractionError, buildExtractionBody, parseExtraction } from "@/lib/memory/extract.ts";
import { buildPayload } from "@/lib/memory/prompt.ts";
import { describeDecision, reconcile } from "@/lib/memory/reconcile.ts";
import { retrieve } from "@/lib/memory/retrieve.ts";
import type { CandidateFact } from "@/lib/memory/types.ts";
import { getStore } from "@/lib/store/index.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_MESSAGE_LENGTH = 2000;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sessionId?: unknown; message?: unknown };

    if (!isUuid(typeof body.sessionId === "string" ? body.sessionId : null)) {
      return failure(400, "INVALID_SESSION", "That is not a session id.");
    }
    const sessionId = body.sessionId as string;

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (message === "") return failure(400, "EMPTY_MESSAGE", "There was no message to send.");
    if (message.length > MAX_MESSAGE_LENGTH) {
      return failure(400, "MESSAGE_TOO_LONG", `Keep messages under ${MAX_MESSAGE_LENGTH} characters.`);
    }

    const store = getStore();
    const session = await store.getSession(sessionId);
    if (!session) return failure(404, "NO_SESSION", "That session does not exist.");
    if (session.endedAt) {
      return failure(409, "SESSION_ENDED", "That session has ended. Start a new one to keep talking.");
    }
    const person = await store.getPerson(session.personId);
    if (!person) return failure(404, "NO_PERSON", "That session has no person attached to it.");

    // Read the transcript before the new message is added, so what goes to the
    // model is exactly what came before it in THIS session and nothing else.
    const transcript = await store.listTurns(sessionId);
    const now = new Date().toISOString();

    await store.appendTurn({
      id: crypto.randomUUID(),
      sessionId,
      role: "user",
      text: message,
      createdAt: now,
    });

    // Step one: work out what, if anything, is worth remembering from this
    // message. A failure here is reported rather than hidden, because a memory
    // demo that silently stops remembering is worse than one that is down.
    let candidates: CandidateFact[] = [];
    let extraction:
      | { ok: true; candidates: number }
      | { ok: false; code: string; message: string };
    try {
      const raw = await callGemini(EXTRACTION_MODEL, buildExtractionBody(message));
      candidates = parseExtraction(raw);
      extraction = { ok: true, candidates: candidates.length };
    } catch (error) {
      if (error instanceof ProviderError) {
        extraction = { ok: false, code: error.code, message: error.message };
      } else if (error instanceof ExtractionError) {
        extraction = { ok: false, code: "EXTRACTION_FAILED", message: error.message };
      } else {
        throw error;
      }
    }

    // Step two: decide what those candidates mean against what is already known.
    // This is the part with no model in it.
    const before = await store.listMemories(person.id);
    const decisions = reconcile(before, candidates, {
      personId: person.id,
      sessionId,
      now,
      newId: () => crypto.randomUUID(),
    });
    await store.applyDecisions(decisions);

    // Step three: retrieve, build the payload, and answer.
    const memories = await store.listMemories(person.id);
    const retrieval = retrieve(memories, message);
    const { body: payloadBody, stats } = buildPayload({
      handle: person.handle,
      memories: retrieval.selected.map((r) => r.memory),
      activeCount: retrieval.activeCount,
      transcript,
      userMessage: message,
      sessionId,
    });

    const reply = await callGemini(CHAT_MODEL, payloadBody);

    await store.appendTurn({
      id: crypto.randomUUID(),
      sessionId,
      role: "model",
      text: reply,
      createdAt: new Date().toISOString(),
      payload: { endpoint: endpointForDisplay(CHAT_MODEL), model: CHAT_MODEL, body: payloadBody, stats },
    });

    return NextResponse.json({
      reply,
      memories,
      extraction,
      decisions: decisions.map((decision) => ({
        kind: decision.kind,
        description: describeDecision(decision),
      })),
      retrieval: {
        strategy: retrieval.strategy,
        activeCount: retrieval.activeCount,
        limit: retrieval.limit,
        selected: retrieval.selected.map((r) => ({
          id: r.memory.id,
          statement: r.memory.statement,
          score: r.score,
          reason: r.reason,
        })),
        heldBack: retrieval.heldBack.map((r) => ({
          id: r.memory.id,
          statement: r.memory.statement,
          score: r.score,
          reason: r.reason,
        })),
      },
      payload: {
        endpoint: endpointForDisplay(CHAT_MODEL),
        model: CHAT_MODEL,
        body: payloadBody,
        stats,
      },
    });
  } catch (error) {
    return fromThrown(error);
  }
}
