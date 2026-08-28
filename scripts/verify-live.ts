/**
 * End to end acceptance test against a running deployment.
 *
 *   npm run verify                                     # against localhost:3000
 *   npm run verify -- https://recall-memory-demo.vercel.app
 *
 * This is the definition of done expressed as code. It talks to the deployment
 * only over HTTP, exactly as a stranger's browser would, and it proves the one
 * behaviour the project exists to demonstrate: that a fact told in one session
 * is still known in a different session that starts with an empty transcript.
 *
 * It cleans up after itself, so it is safe to run against production.
 */

export {}; // top level await needs this file to be a module

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const suffix = Math.random().toString(36).slice(2, 8);
const alice = `verify-${suffix}`;
const bob = `verify-other-${suffix}`;

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

/**
 * This script makes about twenty model calls in a row, which is exactly the
 * free tier ceiling per minute. Backing off on a rate limit is the test being
 * well behaved, not the test hiding a failure: anything other than a 429 still
 * throws immediately.
 */
/**
 * One chat turn costs two model calls, and the free tier ceiling is twenty
 * requests a minute. This script fires a whole conversation back to back, which
 * a human never does, so it paces itself rather than relying on the backoff
 * below to dig it out of a hole it created.
 */
const MIN_GAP_BETWEEN_TURNS_MS = 7000;
let lastTurnAt = 0;

async function api<T>(path: string, init?: RequestInit, attempt = 1): Promise<T> {
  if (path.startsWith("/api/chat")) {
    const wait = lastTurnAt + MIN_GAP_BETWEEN_TURNS_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastTurnAt = Date.now();
  }

  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });

  if (response.status === 502 && attempt <= 5) {
    const body = await response.clone().text();
    if (/RATE_LIMITED/.test(body)) {
      // Honour the delay the provider asks for rather than capping below it.
      // Capping at twenty seconds when it asked for fifty seven just guarantees the
      // retry fails too, and makes a recoverable wait look like a hard failure.
      const suggested = Number(/retry in ([\d.]+)s/i.exec(body)?.[1] ?? 0);
      const wait = Math.min(Math.max(suggested * 1000, 2000) + 1500, 120000);
      console.log(`        rate limited, waiting ${Math.round(wait / 1000)}s and retrying`);
      await sleep(wait);
      return api<T>(path, init, attempt + 1);
    }
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non JSON (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }
  if (!response.ok) {
    const error = (parsed as { error?: { code?: string; message?: string } }).error;
    throw new Error(`${path} failed (HTTP ${response.status}) ${error?.code ?? ""}: ${error?.message ?? text.slice(0, 300)}`);
  }
  return parsed as T;
}

interface SessionShape {
  person: { id: string; handle: string };
  session: { id: string };
  memories: Array<{ id: string; lineageId: string; statement: string; status: string }>;
}

interface ChatShape {
  reply: string;
  memories: Array<{ id: string; lineageId: string; statement: string; status: string }>;
  payload: { model: string; stats: { transcriptMessages: number; memoriesIncluded: number } };
  decisions: Array<{ kind: string; description: string }>;
  extraction: { ok: boolean };
}

console.log(`\nrecall acceptance test against ${base}\n`);

// ---------------------------------------------------------------- session one
const first = await api<SessionShape>("/api/session", {
  method: "POST",
  body: JSON.stringify({ handle: alice }),
});
check("a stranger can start a session with no sign up", Boolean(first.session.id));
check("a new person starts with nothing stored", first.memories.length === 0);

const told = await api<ChatShape>("/api/chat", {
  method: "POST",
  body: JSON.stringify({
    sessionId: first.session.id,
    message: "I live in Reykjavik and my dog is called Pancake.",
  }),
});
check("extraction succeeded", told.extraction.ok);
check(
  "facts were written",
  told.memories.length >= 2,
  `stored ${told.memories.length}: ${told.memories.map((m) => m.statement).join(" / ")}`,
);
const knowsCity = told.memories.some((m) => /reykjavik/i.test(m.statement));
const knowsDog = told.memories.some((m) => /pancake/i.test(m.statement));
check("the city was extracted", knowsCity);
check("the dog was extracted", knowsDog);

// -------------------------------------------------------- idempotency on repeat
const again = await api<ChatShape>("/api/chat", {
  method: "POST",
  body: JSON.stringify({ sessionId: first.session.id, message: "I live in Reykjavik." }),
});
check(
  "saying the same thing again stores no new row",
  again.memories.filter((m) => /reykjavik/i.test(m.statement) && m.status === "active").length === 1,
);
check(
  "the repeat was recognised as already known",
  again.decisions.some((d) => d.kind === "duplicate"),
  again.decisions.map((d) => d.description).join(" | ") || "no decisions returned",
);

// ------------------------------------------------------------- end the session
await api(`/api/session?id=${first.session.id}`, { method: "DELETE" });
const ended = await api<{ session: { endedAt: string | null } }>(
  `/api/session?id=${first.session.id}`,
);
check("the session is closed in the database", Boolean(ended.session.endedAt));

const rejected = await fetch(`${base}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ sessionId: first.session.id, message: "still there?" }),
});
check("an ended session refuses further messages", rejected.status === 409);

// ---------------------------------------------------------------- session two
const second = await api<SessionShape>("/api/session", {
  method: "POST",
  body: JSON.stringify({ handle: alice }),
});
check("the new session has a different id", second.session.id !== first.session.id);
check("the stored facts survived the session ending", second.memories.length >= 2);

const recalled = await api<ChatShape>("/api/chat", {
  method: "POST",
  body: JSON.stringify({ sessionId: second.session.id, message: "Where do I live and what is my dog called?" }),
});
check(
  "THE ONE BEHAVIOUR: it answers correctly in a session that never heard it",
  /reykjavik/i.test(recalled.reply) && /pancake/i.test(recalled.reply),
  `reply was: ${recalled.reply}`,
);
check(
  "THE PROOF: no transcript was carried into the new session",
  recalled.payload.stats.transcriptMessages === 0,
  `transcriptMessages was ${recalled.payload.stats.transcriptMessages}`,
);
check("the answer came from retrieved memories", recalled.payload.stats.memoriesIncluded >= 2);
check("the model in use is named in the payload", Boolean(recalled.payload.model));

// ------------------------------------------------------------ people are separate
const other = await api<SessionShape>("/api/session", {
  method: "POST",
  body: JSON.stringify({ handle: bob }),
});
check("a different person sees none of it", other.memories.length === 0);
const otherAsked = await api<ChatShape>("/api/chat", {
  method: "POST",
  body: JSON.stringify({ sessionId: other.session.id, message: "Where do I live?" }),
});
check(
  "and the model does not leak the other person's facts",
  !/reykjavik/i.test(otherAsked.reply),
  `reply was: ${otherAsked.reply}`,
);

// -------------------------------------------------------------- forgetting works
const lineages = [...new Set(second.memories.map((m) => m.lineageId))];
for (const lineage of lineages) {
  await api(`/api/memories?personId=${first.person.id}&lineageId=${lineage}`, { method: "DELETE" });
}
const afterDelete = await api<{ memories: unknown[] }>(`/api/memories?personId=${first.person.id}`);
check("deleting removes the facts for good", afterDelete.memories.length === 0);

const third = await api<SessionShape>("/api/session", {
  method: "POST",
  body: JSON.stringify({ handle: alice }),
});
const forgotten = await api<ChatShape>("/api/chat", {
  method: "POST",
  body: JSON.stringify({ sessionId: third.session.id, message: "Where do I live?" }),
});
check(
  "and a later session genuinely does not know any more",
  !/reykjavik/i.test(forgotten.reply),
  `reply was: ${forgotten.reply}`,
);

// ------------------------------------------------------------------- clean up
for (const id of [first.session.id, second.session.id, third.session.id, other.session.id]) {
  await fetch(`${base}/api/session?id=${id}`, { method: "DELETE" }).catch(() => {});
}

console.log(
  failures === 0
    ? `\nAll checks passed against ${base}\n`
    : `\n${failures} check${failures === 1 ? "" : "s"} failed against ${base}\n`,
);
process.exit(failures === 0 ? 0 : 1);
