import test from "node:test";
import assert from "node:assert/strict";
import { reconcile, describeDecision } from "../src/lib/memory/reconcile.ts";
import { asKind, CTX, idSequence, memory } from "./helpers.ts";

test("a fact nobody has mentioned before is stored", () => {
  const decisions = reconcile([], [{ attribute: "location", statement: "Lives in Manila" }], {
    ...CTX,
    newId: idSequence(),
  });
  assert.equal(decisions.length, 1);
  const stored = asKind(decisions[0], "store");
  assert.equal(stored.memory.statement, "Lives in Manila");
  assert.equal(stored.memory.lineageId, stored.memory.id, "a new fact starts its own lineage");
});

test("saying the same thing again stores nothing and counts the mention", () => {
  const existing = [memory({ id: "a", attribute: "location", statement: "Lives in Manila" })];
  const decisions = reconcile(existing, [{ attribute: "location", statement: "lives in manila!" }], {
    ...CTX,
    newId: idSequence(),
  });
  assert.equal(decisions.length, 1);
  const duplicate = asKind(decisions[0], "duplicate");
  assert.equal(duplicate.existingId, "a");
  assert.equal(duplicate.mentionCount, 2);
});

test("one message that states the same fact twice counts as one mention", () => {
  const decisions = reconcile(
    [],
    [
      { attribute: "location", statement: "Lives in Cebu" },
      { attribute: "Location", statement: "lives in cebu" },
    ],
    { ...CTX, newId: idSequence() },
  );
  assert.equal(decisions.length, 1, "the second candidate collapses into the first");
  asKind(decisions[0], "store");
});

test("changing your mind about a single valued fact supersedes the old one", () => {
  const existing = [
    memory({ id: "a", attribute: "location", statement: "Lives in Manila", lineageId: "L1" }),
  ];
  const decisions = reconcile(existing, [{ attribute: "location", statement: "Lives in Cebu" }], {
    ...CTX,
    newId: idSequence(),
  });
  const superseded = asKind(decisions[0], "supersede");
  assert.deepEqual(superseded.supersedes, [{ id: "a", statement: "Lives in Manila" }]);
  assert.equal(superseded.memory.lineageId, "L1", "the replacement joins the lineage it replaced");
  assert.equal(superseded.memory.statement, "Lives in Cebu");
});

test("a multi valued fact is kept alongside the ones already held", () => {
  const existing = [memory({ id: "a", attribute: "likes", statement: "Likes coffee" })];
  const decisions = reconcile(existing, [{ attribute: "likes", statement: "Likes tea" }], {
    ...CTX,
    newId: idSequence(),
  });
  const appended = asKind(decisions[0], "append");
  assert.notEqual(appended.memory.lineageId, "seed", "an appended fact starts its own lineage");
});

test("an attribute the registry has never seen appends rather than replaces", () => {
  const existing = [memory({ id: "a", attribute: "favourite_biscuit", statement: "Likes hobnobs" })];
  const decisions = reconcile(
    existing,
    [{ attribute: "favourite_biscuit", statement: "Likes digestives" }],
    { ...CTX, newId: idSequence() },
  );
  asKind(decisions[0], "append");
});

test("two contradictory values reaching storage are both retired by the next mention", () => {
  const existing = [
    memory({
      id: "a",
      attribute: "location",
      statement: "Lives in Manila",
      createdAt: "2026-08-01T00:00:00.000Z",
      lineageId: "L1",
    }),
    memory({
      id: "b",
      attribute: "location",
      statement: "Lives in Davao",
      createdAt: "2026-08-05T00:00:00.000Z",
      lineageId: "L2",
    }),
  ];
  const decisions = reconcile(existing, [{ attribute: "location", statement: "Lives in Cebu" }], {
    ...CTX,
    newId: idSequence(),
  });
  const superseded = asKind(decisions[0], "supersede");
  assert.equal(superseded.supersedes.length, 2);
  assert.equal(superseded.memory.lineageId, "L2", "the newest lineage is the one carried forward");
});

test("two candidates for one single valued attribute in the same message settle on the last", () => {
  const decisions = reconcile(
    [],
    [
      { attribute: "location", statement: "Lives in Manila" },
      { attribute: "location", statement: "Lives in Cebu" },
    ],
    { ...CTX, newId: idSequence() },
  );
  assert.equal(decisions.length, 2);
  asKind(decisions[0], "store");
  const superseded = asKind(decisions[1], "supersede");
  assert.equal(superseded.supersedes[0].statement, "Lives in Manila");
});

test("superseded memories are invisible to reconcile, so an old value can be stated again", () => {
  const existing = [
    memory({
      id: "a",
      attribute: "location",
      statement: "Lives in Manila",
      status: "superseded",
      supersededById: "b",
      supersededAt: "2026-08-10T00:00:00.000Z",
    }),
    memory({
      id: "b",
      attribute: "location",
      statement: "Lives in Cebu",
      createdAt: "2026-08-10T00:00:00.000Z",
    }),
  ];
  const decisions = reconcile(existing, [{ attribute: "location", statement: "Lives in Manila" }], {
    ...CTX,
    newId: idSequence(),
  });
  asKind(decisions[0], "supersede");
});

test("blank statements are dropped before anything is written", () => {
  const decisions = reconcile([], [{ attribute: "goal", statement: "   " }], {
    ...CTX,
    newId: idSequence(),
  });
  assert.deepEqual(decisions, []);
});

test("every decision explains itself in words a non engineer can check", () => {
  const existing = [memory({ id: "a", attribute: "location", statement: "Lives in Manila" })];
  const decisions = reconcile(existing, [{ attribute: "location", statement: "Lives in Cebu" }], {
    ...CTX,
    newId: idSequence(),
  });
  const text = describeDecision(decisions[0]);
  assert.match(text, /Replaced "Lives in Manila" with "Lives in Cebu"/);
  assert.doesNotMatch(text, /—/, "no em dashes anywhere in the copy");
});
