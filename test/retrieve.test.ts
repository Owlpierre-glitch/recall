import test from "node:test";
import assert from "node:assert/strict";
import { retrieve } from "../src/lib/memory/retrieve.ts";
import { memory } from "./helpers.ts";

const FACTS = [
  memory({ id: "a", attribute: "location", statement: "Lives in Cebu" }),
  memory({ id: "b", attribute: "likes", statement: "Likes strong coffee" }),
  memory({ id: "c", attribute: "job_title", statement: "Works as an automation engineer" }),
];

test("at demo scale nothing is filtered, and the result says so", () => {
  const result = retrieve(FACTS, "where do I live?");
  assert.equal(result.strategy, "all");
  assert.equal(result.selected.length, 3);
  assert.deepEqual(result.heldBack, []);
});

test("superseded facts are never retrieved", () => {
  const withOld = [
    ...FACTS,
    memory({
      id: "old",
      attribute: "location",
      statement: "Lives in Manila",
      status: "superseded",
      supersededById: "a",
    }),
  ];
  const result = retrieve(withOld, "where do I live?");
  assert.equal(result.activeCount, 3);
  assert.ok(!result.selected.some((r) => r.memory.id === "old"));
});

test("relevance orders the list even when everything is included", () => {
  const result = retrieve(FACTS, "tell me about coffee");
  assert.equal(result.selected[0].memory.id, "b");
  assert.match(result.selected[0].reason, /1 word in common/);
});

test("a question matching nothing still gets every fact, so open questions work", () => {
  const result = retrieve(FACTS, "what do you know about me");
  assert.equal(result.selected.length, 3);
  assert.ok(result.selected.every((r) => r.score === 0));
  assert.match(result.selected[0].reason, /no words in common/);
});

test("past the budget the surplus is held back rather than quietly dropped", () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    memory({ id: `m${i}`, attribute: "likes", statement: `Likes thing number ${i}` }),
  );
  many.push(memory({ id: "hit", attribute: "location", statement: "Lives in Cebu" }));
  const result = retrieve(many, "where in Cebu", 10);
  assert.equal(result.strategy, "ranked");
  assert.equal(result.selected.length, 10);
  assert.equal(result.heldBack.length, 21);
  assert.equal(result.activeCount, 31);
  assert.equal(result.selected[0].memory.id, "hit", "the relevant fact survives the cut");
});

test("a fact repeated many times outranks one mentioned once when neither matches", () => {
  const repeated = memory({ id: "loud", attribute: "goal", statement: "Wants to move abroad", mentionCount: 4 });
  const quiet = memory({ id: "quiet", attribute: "goal", statement: "Wants a dog" });
  const result = retrieve([quiet, repeated], "hello there", 10);
  assert.equal(result.selected[0].memory.id, "loud");
});
