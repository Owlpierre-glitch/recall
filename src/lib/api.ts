import { NextResponse } from "next/server";
import { ProviderError } from "./gemini.ts";
import { ConfigurationError } from "./store/index.ts";

/**
 * One place where server side failures become something the screen can show.
 *
 * Every error that leaves a route carries a code and a sentence written for the
 * person looking at it. Nothing is flattened into "something went wrong", which
 * is the failure mode this project exists partly to argue against.
 */

export interface ApiFailure {
  error: {
    code: string;
    message: string;
    provider?: string;
    model?: string;
    status?: number | null;
  };
}

export function failure(status: number, code: string, message: string): NextResponse<ApiFailure> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function fromThrown(error: unknown): NextResponse<ApiFailure> {
  if (error instanceof ProviderError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          provider: error.provider,
          model: error.model,
          status: error.status,
        },
      },
      { status: 502 },
    );
  }
  if (error instanceof ConfigurationError) {
    return failure(500, error.code, error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return failure(500, "UNEXPECTED", `The server failed while handling this request. ${message}`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null): value is string {
  return typeof value === "string" && UUID.test(value);
}

export const HANDLE_MAX = 32;

/** Returns the cleaned handle, or a reason it was rejected. */
export function cleanHandle(raw: unknown): { handle: string } | { reason: string } {
  if (typeof raw !== "string") return { reason: "A name is required." };
  const handle = raw.trim().replace(/\s+/g, " ");
  if (handle.length < 2) return { reason: "That name is too short. Use at least two characters." };
  if (handle.length > HANDLE_MAX) {
    return { reason: `That name is too long. Keep it under ${HANDLE_MAX} characters.` };
  }
  if (!/^[\p{L}\p{N} ._-]+$/u.test(handle)) {
    return { reason: "Use letters, numbers, spaces, dots, dashes or underscores." };
  }
  return { handle };
}
