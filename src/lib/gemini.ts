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
 * Pinned deliberately, and pinned to a current model rather than whatever
 * happened to work the day this was written.
 *
 * This project was first built against gemini-2.5-flash. It worked. Then a
 * probe against gemini-2.5-flash-lite came back with "no longer available to
 * new users, please update your code to models/gemini-3.5-flash-lite", which is
 * the whole reason the error handling below is written the way it is: the model
 * that is fine for the key that built the thing can already be closed to
 * everybody else. A public repo pinned to a model new users cannot call is
 * broken for every person who clones it, and nothing in the app would have said
 * so out loud.
 *
 * Changing this is a code change with a commit against it, never silent config
 * drift, and an unavailable model names itself on screen.
 */
/**
 * Both models are "lite", and both are pinned for the same measured reason.
 *
 * The flagship `gemini-3.5-flash` gives a free tier key twenty requests A DAY,
 * not a minute. That was established the slow way: once exhausted, the API kept
 * answering "please retry in about fifty seconds" and never recovered across
 * several minutes of honouring that delay. Twenty requests a day is fine for
 * development and useless for a link a stranger might click, which is what this
 * is for. The lite models carry far larger free allowances.
 *
 * They are also two DIFFERENT models on purpose. Quota is counted per model and
 * one turn here costs two requests, so putting both calls on one model would
 * halve the ceiling for no benefit.
 *
 * And the split is the right shape anyway: extraction is a narrow, schema
 * constrained task at temperature zero, while answering someone about their own
 * life is where quality actually shows.
 *
 * If this is ever run on a billed key, `gemini-3.5-flash` is a good CHAT_MODEL.
 */
export const CHAT_MODEL = "gemini-3.5-flash-lite";
export const EXTRACTION_MODEL = "gemini-3.1-flash-lite";

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

/**
 * One retry on a rate limit, using the delay the provider itself suggests.
 *
 * This is not a softening of the rule that failures are loud. A 429 is a
 * documented transient condition with a stated retry time, and the free tier
 * ceiling is twenty requests a minute while a single turn costs two of them. A
 * stranger clicking the link should not be told to come back later because two
 * other people were curious at the same moment. If the retry also fails, the
 * error reaches the screen naming the model and the limit, exactly as before.
 */
const RATE_LIMIT_RETRIES = 1;
const MAX_BACKOFF_MS = 8000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function callGemini(
  model: string,
  body: GeminiRequestBody,
  signal?: AbortSignal,
  attempt = 0,
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
      if (attempt < RATE_LIMIT_RETRIES) {
        const suggested = Number(/retry in ([\d.]+)s/i.exec(detail)?.[1] ?? 0);
        const wait = Math.min(Math.max(suggested * 1000, 1500) + 400, MAX_BACKOFF_MS);
        await sleep(wait);
        return callGemini(model, body, signal, attempt + 1);
      }
      throw new ProviderError({
        message: `Rate limited by Gemini while calling ${model}, and a retry was also refused. Free tier keys have a daily request allowance per model and this one is spent. Provider said: ${detail}`,
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
