import test from "node:test";
import assert from "node:assert/strict";
import { BASE_INSTRUCTIONS, buildMemoryBlock, buildPayload } from "../src/lib/memory/prompt.ts";
import type { Turn } from "../src/lib/memory/types.ts";
import { memory } from "./helpers.ts";

const FACTS = [
  memory({ id: "a", attribute: "location", statement: "Lives in Cebu", sourceSessionId: "11112222-3333" }),
];

function turn(role: "user" | "model", text: string): Turn {
  return { id: `t-${text}`, sessionId: "s1", role, text, createdAt: "2026-08-28T00:00:00.000Z" };
}

test("a brand new session sends zero transcript messages, which is the whole proof", () => {
  const { body, stats } = buildPayload({
    handle: "sam",
    memories: FACTS,
    activeCount: 1,
    transcript: [],
    userMessage: "where do I live?",
  });
  assert.equal(stats.transcriptMessages, 0);
  assert.equal(body.contents.length, 1, "only the message just typed");
  assert.equal(body.contents[0].role, "user");
  assert.equal(body.contents[0].parts[0].text, "where do I live?");
  assert.equal(stats.memoriesIncluded, 1);
});

test("the stored fact is the only place the answer can come from", () => {
  const { body } = buildPayload({
    handle: "sam",
    memories: FACTS,
    activeCount: 1,
    transcript: [],
    userMessage: "where do I live?",
  });
  const system = body.systemInstruction.parts[0].text;
  assert.match(system, /Lives in Cebu/);
  assert.match(system, /\[location\]/);
  assert.match(system, /session 11112222/, "provenance travels with the fact");
});

test("later turns in the same session carry that session's transcript, and it is counted", () => {
  const { body, stats } = buildPayload({
    handle: "sam",
    memories: [],
    activeCount: 0,
    transcript: [turn("user", "hi"), turn("model", "hello")],
    userMessage: "still there?",
  });
  assert.equal(stats.transcriptMessages, 2);
  assert.equal(body.contents.length, 3);
  assert.deepEqual(
    body.contents.map((c) => c.role),
    ["user", "model", "user"],
  );
});

test("an empty memory block says plainly that nothing is known", () => {
  const block = buildMemoryBlock("sam", [], 0);
  assert.match(block, /none\. Nothing has been stored/);
});

test("a trimmed memory block admits it was trimmed", () => {
  const block = buildMemoryBlock("sam", FACTS, 40);
  assert.match(block, /40 held, the 1 most relevant included/);
});

test("no em dashes reach the model or the screen", () => {
  const { body } = buildPayload({
    handle: "sam",
    memories: FACTS,
    activeCount: 1,
    transcript: [],
    userMessage: "hi",
  });
  assert.doesNotMatch(BASE_INSTRUCTIONS, /—/);
  assert.doesNotMatch(body.systemInstruction.parts[0].text, /—/);
});
