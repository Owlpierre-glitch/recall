import { NextResponse } from "next/server";
import { cleanHandle, failure, fromThrown, isUuid } from "@/lib/api.ts";
import { getStore } from "@/lib/store/index.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts a session for a handle, creating the person if this is their first visit. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { handle?: unknown };
    const result = cleanHandle(body.handle);
    if ("reason" in result) return failure(400, "INVALID_HANDLE", result.reason);

    const store = getStore();
    const person = await store.ensurePerson(result.handle);
    const session = await store.createSession(person.id);
    const memories = await store.listMemories(person.id);

    return NextResponse.json({ person, session, memories, turns: [], lastPayload: null });
  } catch (error) {
    return fromThrown(error);
  }
}

/** Resumes a session after a page reload. A reload is not a new session. */
export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!isUuid(id)) return failure(400, "INVALID_SESSION", "That is not a session id.");

    const store = getStore();
    const session = await store.getSession(id);
    if (!session) return failure(404, "NO_SESSION", "That session does not exist.");

    const person = await store.getPerson(session.personId);
    if (!person) return failure(404, "NO_PERSON", "That session has no person attached to it.");

    const [memories, turns, lastPayload] = await Promise.all([
      store.listMemories(person.id),
      store.listTurns(session.id),
      store.lastPayload(session.id),
    ]);

    return NextResponse.json({ person, session, memories, turns, lastPayload });
  } catch (error) {
    return fromThrown(error);
  }
}

/**
 * Ends a session for good. The next one gets a new id, which is what makes
 * "it remembered across sessions" a claim a sceptic can check rather than a
 * screen that was cleared.
 */
export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!isUuid(id)) return failure(400, "INVALID_SESSION", "That is not a session id.");

    const store = getStore();
    const session = await store.endSession(id);
    if (!session) return failure(404, "NO_SESSION", "That session does not exist.");

    return NextResponse.json({ session });
  } catch (error) {
    return fromThrown(error);
  }
}
