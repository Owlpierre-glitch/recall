import test from "node:test";
import assert from "node:assert/strict";
import { reconcile } from "../src/lib/memory/reconcile.ts";
import { InMemoryStore } from "../src/lib/store/memory-store.ts";
import { PostgresStore } from "../src/lib/store/pg-store.ts";
import type { Store } from "../src/lib/store/types.ts";

/**
 * One contract, two implementations.
 *
 * The in-memory store exists so the suite runs offline in under a second. That
 * is only worth anything if it behaves like the real one, so both are put
 * through exactly the same checks. The Postgres run is skipped unless
 * DATABASE_URL is set, which keeps `npm test` honest and dependency free while
 * still being able to prove the two agree:
 *
 *   DATABASE_URL="postgres://..." npm test
 */

function suite(name: string, makeStore: () => Store, skip: boolean) {
  const options = skip ? { skip: "DATABASE_URL is not set" } : {};

  test(`${name}: the same handle in any casing is the same person`, options, async () => {
    const store = makeStore();
    try {
      const first = await store.ensurePerson("Sam");
      const second = await store.ensurePerson("  sam  ");
      assert.equal(second.id, first.id);
      assert.equal(second.handle, "Sam", "the name is kept as first written");
    } finally {
      await store.close();
    }
  });

  test(`${name}: a memory outlives the session that created it`, options, async () => {
    const store = makeStore();
    try {
      const person = await store.ensurePerson(`sam-${crypto.randomUUID().slice(0, 8)}`);
      const first = await store.createSession(person.id);

      const decisions = reconcile([], [{ attribute: "location", statement: "Lives in Cebu" }], {
        personId: person.id,
        sessionId: first.id,
        now: new Date().toISOString(),
        newId: () => crypto.randomUUID(),
      });
      await store.applyDecisions(decisions);

      await store.endSession(first.id);
      const ended = await store.getSession(first.id);
      assert.ok(ended?.endedAt, "the session is genuinely closed");

      // A completely separate session, as if the browser had been closed.
      const second = await store.createSession(person.id);
      assert.notEqual(second.id, first.id);
      assert.deepEqual(await store.listTurns(second.id), [], "the new session starts empty");

      const remembered = await store.listMemories(person.id);
      assert.equal(remembered.length, 1);
      assert.equal(remembered[0].statement, "Lives in Cebu");
      assert.equal(remembered[0].sourceSessionId, first.id, "provenance points at the session that is now over");
    } finally {
      await store.close();
    }
  });

  test(`${name}: repeating a fact updates the count and adds no row`, options, async () => {
    const store = makeStore();
    try {
      const person = await store.ensurePerson(`sam-${crypto.randomUUID().slice(0, 8)}`);
      const session = await store.createSession(person.id);
      const ctx = {
        personId: person.id,
        sessionId: session.id,
        now: new Date().toISOString(),
        newId: () => crypto.randomUUID(),
      };

      await store.applyDecisions(reconcile([], [{ attribute: "likes", statement: "Likes tea" }], ctx));
      const afterFirst = await store.listMemories(person.id);
      await store.applyDecisions(
        reconcile(afterFirst, [{ attribute: "likes", statement: "likes tea." }], ctx),
      );

      const memories = await store.listMemories(person.id);
      assert.equal(memories.length, 1, "no second row for the same fact");
      assert.equal(memories[0].mentionCount, 2);
    } finally {
      await store.close();
    }
  });

  test(`${name}: a correction retires the old fact and keeps it as history`, options, async () => {
    const store = makeStore();
    try {
      const person = await store.ensurePerson(`sam-${crypto.randomUUID().slice(0, 8)}`);
      const session = await store.createSession(person.id);
      const ctx = {
        personId: person.id,
        sessionId: session.id,
        now: new Date().toISOString(),
        newId: () => crypto.randomUUID(),
      };

      await store.applyDecisions(reconcile([], [{ attribute: "location", statement: "Lives in Manila" }], ctx));
      const before = await store.listMemories(person.id);
      await store.applyDecisions(
        reconcile(before, [{ attribute: "location", statement: "Lives in Cebu" }], {
          ...ctx,
          now: new Date(Date.now() + 1000).toISOString(),
        }),
      );

      const memories = await store.listMemories(person.id);
      assert.equal(memories.length, 2, "the old value is kept as history, not overwritten");
      const active = memories.filter((m) => m.status === "active");
      const retired = memories.filter((m) => m.status === "superseded");
      assert.equal(active.length, 1);
      assert.equal(active[0].statement, "Lives in Cebu");
      assert.equal(retired.length, 1);
      assert.equal(retired[0].statement, "Lives in Manila");
      assert.equal(retired[0].supersededById, active[0].id, "history points at what replaced it");
      assert.equal(retired[0].lineageId, active[0].lineageId, "both are one lineage");
    } finally {
      await store.close();
    }
  });

  test(`${name}: deleting a memory removes its history too`, options, async () => {
    const store = makeStore();
    try {
      const person = await store.ensurePerson(`sam-${crypto.randomUUID().slice(0, 8)}`);
      const session = await store.createSession(person.id);
      const ctx = {
        personId: person.id,
        sessionId: session.id,
        now: new Date().toISOString(),
        newId: () => crypto.randomUUID(),
      };

      await store.applyDecisions(reconcile([], [{ attribute: "location", statement: "Lives in Manila" }], ctx));
      let all = await store.listMemories(person.id);
      await store.applyDecisions(
        reconcile(all, [{ attribute: "location", statement: "Lives in Cebu" }], {
          ...ctx,
          now: new Date(Date.now() + 1000).toISOString(),
        }),
      );
      await store.applyDecisions(
        reconcile(await store.listMemories(person.id), [{ attribute: "likes", statement: "Likes tea" }], ctx),
      );

      all = await store.listMemories(person.id);
      const lineage = all.find((m) => m.attribute === "location")!.lineageId;
      const { deleted } = await store.deleteLineage(person.id, lineage);

      assert.equal(deleted, 2, "the current value and the one it replaced both go");
      const left = await store.listMemories(person.id);
      assert.equal(left.length, 1);
      assert.equal(left[0].attribute, "likes");
      assert.ok(
        !left.some((m) => m.statement.includes("Manila")),
        "forgetting has to be real, not hidden",
      );
    } finally {
      await store.close();
    }
  });

  test(`${name}: the payload sent to the model is kept for inspection`, options, async () => {
    const store = makeStore();
    try {
      const person = await store.ensurePerson(`sam-${crypto.randomUUID().slice(0, 8)}`);
      const session = await store.createSession(person.id);
      const now = new Date().toISOString();

      assert.equal(await store.lastPayload(session.id), null);

      await store.appendTurn({
        id: crypto.randomUUID(),
        sessionId: session.id,
        role: "user",
        text: "where do I live?",
        createdAt: now,
      });
      await store.appendTurn({
        id: crypto.randomUUID(),
        sessionId: session.id,
        role: "model",
        text: "In Cebu.",
        createdAt: new Date(Date.now() + 1000).toISOString(),
        payload: { contents: [{ role: "user", parts: [{ text: "where do I live?" }] }] },
      });

      const turns = await store.listTurns(session.id);
      assert.deepEqual(turns.map((t) => t.role), ["user", "model"]);

      const payload = await store.lastPayload(session.id);
      assert.deepEqual(payload, {
        contents: [{ role: "user", parts: [{ text: "where do I live?" }] }],
      });
    } finally {
      await store.close();
    }
  });
}

suite("in memory", () => new InMemoryStore(), false);

const databaseUrl = process.env.DATABASE_URL;
suite("postgres", () => new PostgresStore(databaseUrl ?? "postgres://unset"), !databaseUrl);
