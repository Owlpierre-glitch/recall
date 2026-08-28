import { NextResponse } from "next/server";
import { CHAT_MODEL, EXTRACTION_MODEL } from "@/lib/gemini.ts";
import { ConfigurationError, getStore } from "@/lib/store/index.ts";
import type { HealthReport, Readiness } from "@/lib/client-types.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readiness, so a stranger is told the demo is not available before they type
 * their name rather than after.
 *
 * The three panels exist to let someone check a claim. It would be a poor
 * showing if the front door could not answer the simplest question about
 * itself. This reports what is actually true, including which models are
 * pinned, and never invents a green light.
 */

export type { Readiness };

export async function GET() {
  const keyPresent = Boolean(process.env.GEMINI_API_KEY?.trim());
  let database: HealthReport["database"];

  try {
    const store = getStore();
    // A real query, not just a constructed client. postgres.js connects lazily,
    // so anything less would report healthy on an unreachable database.
    await store.listMemories("00000000-0000-0000-0000-000000000000");
    database = { status: "ok", detail: "connected" };
  } catch (error) {
    database =
      error instanceof ConfigurationError
        ? { status: "unconfigured", detail: error.message }
        : {
            status: "unreachable",
            detail: `The database is configured but did not answer. ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
  }

  const report: HealthReport = {
    ready: database.status === "ok" && keyPresent,
    database,
    models: { chat: CHAT_MODEL, extraction: EXTRACTION_MODEL, keyPresent },
  };

  // A degraded deployment must not answer 200. Anything watching this from the
  // outside should be able to tell without parsing the body.
  return NextResponse.json(report, { status: report.ready ? 200 : 503 });
}
