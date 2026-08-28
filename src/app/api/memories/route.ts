import { NextResponse } from "next/server";
import { failure, fromThrown, isUuid } from "@/lib/api.ts";
import { getStore } from "@/lib/store/index.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const personId = new URL(request.url).searchParams.get("personId");
    if (!isUuid(personId)) return failure(400, "INVALID_PERSON", "That is not a person id.");

    const store = getStore();
    return NextResponse.json({ memories: await store.listMemories(personId) });
  } catch (error) {
    return fromThrown(error);
  }
}

/**
 * Deletes a fact and the whole chain of values it replaced.
 *
 * Deleting only the current value would leave "Lives in Manila" sitting in the
 * table after the person asked to be forgotten about where they live. The row
 * is removed, not flagged.
 */
export async function DELETE(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const personId = params.get("personId");
    const lineageId = params.get("lineageId");
    if (!isUuid(personId)) return failure(400, "INVALID_PERSON", "That is not a person id.");
    if (!isUuid(lineageId)) return failure(400, "INVALID_LINEAGE", "That is not a memory id.");

    const store = getStore();
    const { deleted } = await store.deleteLineage(personId, lineageId);
    if (deleted === 0) return failure(404, "NO_MEMORY", "There is no memory with that id to delete.");

    const memories = await store.listMemories(personId);
    return NextResponse.json({ deleted, memories });
  } catch (error) {
    return fromThrown(error);
  }
}
