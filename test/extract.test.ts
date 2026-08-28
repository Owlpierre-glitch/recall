import test from "node:test";
import assert from "node:assert/strict";
import {
  ExtractionError,
  MAX_FACTS_PER_MESSAGE,
  buildExtractionBody,
  parseExtraction,
} from "../src/lib/memory/extract.ts";

test("a well formed extraction becomes candidate facts", () => {
  const facts = parseExtraction(
    JSON.stringify({ facts: [{ attribute: "City", statement: "  Lives in  Cebu " }] }),
  );
  assert.deepEqual(facts, [{ attribute: "location", statement: "Lives in Cebu" }]);
});

test("a fenced code block is still read, because providers do that", () => {
  const facts = parseExtraction('```json\n{"facts":[{"attribute":"likes","statement":"Likes tea"}]}\n```');
  assert.equal(facts.length, 1);
  assert.equal(facts[0].statement, "Likes tea");
});

test("nothing worth remembering is an empty list, not an error", () => {
  assert.deepEqual(parseExtraction('{"facts":[]}'), []);
});

test("a broken extractor throws instead of looking like an empty message", () => {
  // This is the distinction the whole "failures are loud" rule turns on. If a
  // parse failure returned [], a broken extractor would look exactly like a
  // message with nothing to remember, and memory would rot silently.
  assert.throws(() => parseExtraction("I could not do that"), ExtractionError);
  assert.throws(() => parseExtraction(""), ExtractionError);
  assert.throws(() => parseExtraction('{"nope":1}'), ExtractionError);
  assert.throws(() => parseExtraction('{"facts":"Lives in Cebu"}'), ExtractionError);
});

test("malformed entries inside a valid response are skipped, not fatal", () => {
  const facts = parseExtraction(
    JSON.stringify({
      facts: [
        { attribute: "location", statement: "Lives in Cebu" },
        { attribute: 7, statement: "Lives in Davao" },
        { statement: "no attribute" },
        null,
        { attribute: "goal", statement: "x".repeat(400) },
        { attribute: "likes", statement: "Likes tea" },
      ],
    }),
  );
  assert.deepEqual(
    facts.map((f) => f.statement),
    ["Lives in Cebu", "Likes tea"],
  );
});

test("one message cannot flood storage", () => {
  const facts = parseExtraction(
    JSON.stringify({
      facts: Array.from({ length: 40 }, (_, i) => ({ attribute: "likes", statement: `Likes ${i}` })),
    }),
  );
  assert.equal(facts.length, MAX_FACTS_PER_MESSAGE);
});

test("the extraction request asks for JSON and sends only the message just typed", () => {
  const body = buildExtractionBody("I moved to Cebu");
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.contents.length, 1);
  assert.equal(body.contents[0].parts[0].text, "I moved to Cebu");
  assert.doesNotMatch(body.systemInstruction.parts[0].text, /—/);
});
