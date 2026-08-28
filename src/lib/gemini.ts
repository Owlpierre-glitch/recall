import type { GeminiRequestBody } from "./memory/prompt.ts";

/**
 * The provider boundary.
 *
 * An earlier project of mine lost its answers overnight when the provider
 * retired a model out from under it. The app kept returning 200 and showed the
 * user "something went wrong", so the real cause took far longer to find than
 * it should have. Nothing in this file is allowed to swallow a failure. Every
 * error names the provider, the model and the status, and travels to the screen
 * intact.
 */

/**
 * Pinned deliberately. `gemini-2.5-flash` is the stable generally available
 * alias, not a preview build that disappears on a schedule. Changing it is a
 * code change with a commit against it, not a silent config drift.
 */
export const CHAT_MODEL = "gemini-2.5-flash";
export const EXTRACTION_MODEL = "gemini-2.5-flash";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class ProviderError extends Error {
  readonly provider = "google-gemini";
  readonly model: string;
  readonly status: number | null;
  readonly code: string;

  constructor(args: { message: string; model: string; status?: number | null; code: string }) {
    super(args.message);
    this.name = "ProviderError";
    this.model = args.model;
    this.status = args.status ?? null;
    this.code = args.code;
  }

  toJSON() {
    return {
      provider: this.provider,
      model: this.model,
      status: this.status,
      code: this.code,
      message: this.message,
    };
  }
}

/** The endpoint as shown in the payload panel. The key is a header, never a URL. */
export function endpointForDisplay(model: string): string {
  return `POST ${API_BASE}/models/${model}:generateContent`;
}

function readApiKey(model: string): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.trim() === "") {
    throw new ProviderError({
      message:
        "GEMINI_API_KEY is not set on the server, so no request was made. Nothing was stored and nothing was answered.",
      model,
      code: "MISSING_API_KEY",
    });
  }
  return key.trim();
}

interface GeminiErrorShape {
  error?: { code?: number; message?: string; status?: string };
}

export async function callGemini(
  model: string,
  body: GeminiRequestBody,
  signal?: AbortSignal,
): Promise<string> {
  const key = readApiKey(model);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    throw new ProviderError({
      message: `Could not reach Gemini to call ${model}. ${(cause as Error).message}`,
      model,
      code: "NETWORK",
    });
  }

  if (!response.ok) {
    const raw = await response.text();
    let detail = raw.slice(0, 400);
    let status = "";
    try {
      const parsed = JSON.parse(raw) as GeminiErrorShape;
      detail = parsed.error?.message ?? detail;
      status = parsed.error?.status ?? "";
    } catch {
      // Leave the raw body as the detail. A provider returning HTML is itself
      // worth seeing on screen.
    }

    if (response.status === 404 || status === "NOT_FOUND") {
      throw new ProviderError({
        message: `The model ${model} is not available to this API key. It has most likely been retired or renamed by the provider. Update the pinned model in src/lib/gemini.ts. Provider said: ${detail}`,
        model,
        status: response.status,
        code: "MODEL_UNAVAILABLE",
      });
    }
    if (response.status === 429) {
      throw new ProviderError({
        message: `Rate limited by Gemini while calling ${model}. Provider said: ${detail}`,
        model,
        status: response.status,
        code: "RATE_LIMITED",
      });
    }
    throw new ProviderError({
      message: `Gemini rejected the request to ${model} with HTTP ${response.status}. Provider said: ${detail}`,
      model,
      status: response.status,
      code: status || "HTTP_ERROR",
    });
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };

  const blocked = payload.promptFeedback?.blockReason;
  if (blocked) {
    throw new ProviderError({
      message: `Gemini blocked the request to ${model} before generating anything. Reason given: ${blocked}.`,
      model,
      status: response.status,
      code: "BLOCKED",
    });
  }

  const candidate = payload.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  if (text === "") {
    // A 200 with no text is the exact shape of failure that hid the last
    // provider problem for days. It is an error here, not an empty reply.
    throw new ProviderError({
      message: `Gemini returned a response from ${model} with no text in it. Finish reason: ${candidate?.finishReason ?? "not given"}.`,
      model,
      status: response.status,
      code: "EMPTY_RESPONSE",
    });
  }

  return text;
}
