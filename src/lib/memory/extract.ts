import { KNOWN_ATTRIBUTES, normaliseAttribute } from "./attributes.ts";
import type { CandidateFact } from "./types.ts";
import type { GeminiRequestBody } from "./prompt.ts";

/**
 * Extraction: turning a sentence a person typed into candidate facts.
 *
 * The model is used for the one thing only a model can do, which is reading
 * "yeah I finally got out of Manila, Cebu is treating me well" and producing
 * "Lives in Cebu". Every decision about what that then means, whether it
 * duplicates or replaces something, belongs to reconcile() where it can be
 * tested. The model is never asked to decide what to overwrite.
 */

export class ExtractionError extends Error {
  readonly raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = "ExtractionError";
    this.raw = raw;
  }
}

/** A single message cannot be allowed to flood storage. */
export const MAX_FACTS_PER_MESSAGE = 8;
export const MAX_STATEMENT_LENGTH = 200;

export const EXTRACTION_INSTRUCTIONS = [
  "You extract durable facts about a person from something they just typed.",
  "",
  "Return only facts that would still be worth knowing in a month. Store the person's situation, preferences, plans and identity. Ignore small talk, questions they asked, opinions about the world, and anything about anyone other than the person speaking.",
  "",
  "Each fact must be:",
  "- a short third person statement that stands on its own with no context, for example \"Lives in Cebu\" rather than \"moved there last week\"",
  "- filed under an attribute slug naming which part of the person it describes",
  "",
  `Prefer one of these attribute slugs when one fits: ${KNOWN_ATTRIBUTES.join(", ")}. If none fits, invent a short lowercase slug with underscores.`,
  "",
  "If the message contains no durable fact about the person, return an empty list. That is a normal and common answer.",
  "Do not use em dashes.",
].join("\n");

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    facts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          attribute: { type: "STRING" },
          statement: { type: "STRING" },
        },
        required: ["attribute", "statement"],
      },
    },
  },
  required: ["facts"],
} as const;

export function buildExtractionBody(userMessage: string): GeminiRequestBody {
  return {
    systemInstruction: { parts: [{ text: EXTRACTION_INSTRUCTIONS }] },
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 600,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
}

/**
 * Structured output is requested, but a provider is free to hand back a fenced
 * code block or a stray sentence, and one day it will. Parsing is defensive and
 * failure is an exception rather than an empty array, because "the extractor
 * broke" and "there was nothing to remember" must never look the same.
 */
export function parseExtraction(raw: string): CandidateFact[] {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  if (text === "") throw new ExtractionError("The extractor returned nothing", raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ExtractionError("The extractor did not return valid JSON", raw);
  }

  if (typeof parsed !== "object" || parsed === null || !("facts" in parsed)) {
    throw new ExtractionError("The extractor returned JSON with no facts field", raw);
  }

  const facts = (parsed as { facts: unknown }).facts;
  if (!Array.isArray(facts)) {
    throw new ExtractionError("The extractor returned a facts field that is not a list", raw);
  }

  const out: CandidateFact[] = [];
  for (const entry of facts) {
    if (typeof entry !== "object" || entry === null) continue;
    const { attribute, statement } = entry as Record<string, unknown>;
    if (typeof attribute !== "string" || typeof statement !== "string") continue;
    const cleaned = statement.trim().replace(/\s+/g, " ");
    if (cleaned === "" || cleaned.length > MAX_STATEMENT_LENGTH) continue;
    out.push({ attribute: normaliseAttribute(attribute), statement: cleaned });
    if (out.length >= MAX_FACTS_PER_MESSAGE) break;
  }
  return out;
}
