# recall

A chat demo whose memory survives the session ending, and that lets you check it is remembering honestly.

**Live: https://recall-memory-demo.vercel.app**

## The one behaviour

Tell it something. End the session. Start a new one. It still knows.

Not a longer context window, and not the same conversation held open. The new session starts with a
genuinely empty transcript and still answers correctly, purely from what was extracted and stored
earlier.

A chat box that remembers is unremarkable. A chat box that lets you verify it is remembering
honestly is the point of this repo.

## How to check it is not cheating

Three panels are always open, none of them behind a developer flag.

**Stored.** Every fact held about you, when it was written, and which session it came from. You can
delete any of it, and deletion is a `DELETE` statement, not a hidden flag.

**Sent to the model.** The complete request body for the most recent turn, verbatim, with the count
of messages carried over from the current session shown at the top. In a new session that count is
zero. Any correct answer about you therefore came out of the database and from nowhere else.

**Session.** The current session id in full, and a control that closes it in the database and issues
a new one. A cleared screen is not a new session, so the id is there to be compared.

## How it works

```
your message
   |
   +--> extraction        one model call, structured output, returns candidate facts
   |                      src/lib/memory/extract.ts
   |
   +--> reconcile         no model involved. decides store / append / supersede / duplicate
   |                      src/lib/memory/reconcile.ts
   |
   +--> write             one transaction
   |                      src/lib/store/pg-store.ts
   |
   +--> retrieve          rank and select what this question needs
   |                      src/lib/memory/retrieve.ts
   |
   +--> build payload     pure function. what it returns is what is sent, and what the panel shows
   |                      src/lib/memory/prompt.ts
   |
   +--> answer            second model call
```

The model is used for the one thing only a model can do, which is reading "yeah I finally got out of
Manila, Cebu is treating me well" and producing `[location] Lives in Cebu`. Every decision about what
that then *means* belongs to code that can be tested.

## The parts that are actually engineering

**Idempotent writes.** Saying the same thing twice does not store it twice. Each fact carries a
fingerprint of its normalised attribute and statement, and a partial unique index in Postgres
enforces one active row per fingerprint per person. The constraint is in the database rather than
only in application code, so two requests racing cannot both insert. The normalisation is
deliberately dull: no stemming, no stopword removal, no synonyms. Collapsing "works in Manila" and
"does not work in Manila" into one fact would silently destroy something a person told us.

**Conflicting facts.** "I live in Manila", then later "I moved to Cebu". Whether that replaces or
appends is decided by a registry of single valued attributes in `src/lib/memory/attributes.ts`, not
by the model, because a model deciding turn by turn is unrepeatable and untestable. A replacement
does not overwrite. The old row is marked superseded, keeps a pointer to what replaced it, and stays
visible in the panel as history. Attributes the registry has never seen append rather than replace,
on the reasoning that a wrongly appended fact is a visible mess you can correct, and a wrongly
replaced one is gone.

**Failures are loud.** A previous project of mine went quiet when a provider retired a model out from
under it. The app kept returning 200 and showed "something went wrong", which took far longer to
diagnose than it should have. So here the pinned model is a constant in `src/lib/gemini.ts`, a 404
from the provider produces an error that names the model and says it was probably retired, and a 200
carrying no text is treated as a failure rather than an empty reply. A failed extraction is reported
on screen as "nothing was stored from that message" instead of quietly degrading into an answer with
no memory behind it.

That handling earned itself during the build. This was written against `gemini-2.5-flash`, which
worked. A later probe against `gemini-2.5-flash-lite` came back with "no longer available to new
users, please update your code to `models/gemini-3.5-flash-lite`". The model that is fine for the key
that built a thing can already be closed to everyone else, which for a public repo means broken for
every person who clones it, silently. The pin is now on the current generation, and the failure that
would tell you names itself.

**Forgetting works.** Deleting a memory deletes the whole lineage, meaning the current value and
every value it replaced. Deleting only the current one would leave "Lives in Manila" sitting in the
table after somebody asked to be forgotten about where they live. A privacy control that only hides
things is a lie.

**Tests run offline.** `npm test` needs no database, no API key and no network. Extraction parsing,
dedupe, supersede and retrieval are pure functions over plain data. The storage layer has two
implementations, Postgres and in memory, held to one shared contract test, so the fast offline suite
is checking the same rules the deployed app runs under. Point `DATABASE_URL` at a real database and
the same contract runs against Postgres too.

## What is deliberately not here

- **No vector database.** At the size a person actually reaches, a few dozen facts, embeddings would
  add a service, a cost and a failure mode without changing a single answer. Retrieval sends
  everything and says so, and only starts ranking once there are more facts than fit the budget. What
  got left out is shown rather than hidden.
- **No accounts.** Identity is the name you type. That keeps a stranger from having to sign up to try
  the demo, and it makes identity visible, which helps rather than hurts the thing being demonstrated.
  It also means anyone who types the same name sees the same memories, which the app says plainly on
  screen. Nothing private should go in it.
- **No streaming, no RAG over documents, no mobile app.** If it is not needed to prove the one
  behaviour or to let a sceptic verify it, it is not in here.

## Running it locally

```bash
npm install
cp .env.example .env.local   # then fill in both values
npm run migrate              # applies db/schema.sql, safe to run twice
npm run dev
```

`DATABASE_URL` is any Postgres. This one is deployed against Supabase. `GEMINI_API_KEY` comes from
Google AI Studio.

## Tests

```bash
npm test
```

43 tests, no services required. To include the six that run the same storage contract against a
real Postgres:

```bash
DATABASE_URL="postgresql://..." npm test
```

That second run is not decoration. The first time it ran it caught a foreign key ordering bug that the
in memory store had no way to reject, which would have passed every offline test and failed on the
first real write.

## Readiness

`GET /api/health` reports whether the deployment can actually serve anyone, and answers **503** when
it cannot, so something watching from outside does not have to parse the body to find out:

```json
{ "ready": true,
  "database": { "status": "ok", "detail": "connected" },
  "models": { "chat": "...", "extraction": "...", "keyPresent": true } }
```

It runs a real query rather than just constructing a client, because the driver connects lazily and
anything less would report healthy against a database that is not there. The start screen calls it on
load and, if the answer is no, says so and disables the button instead of letting a visitor type a
name and then hit a wall. A demo whose whole argument is that you can inspect its workings should be
able to answer the simplest question about itself.

## What has actually been run against what

Worth stating plainly, because "it works" means different things:

| Checked | How |
| --- | --- |
| Memory layer rules | 43 tests, no network, no database, no key |
| Storage contract | The same 6 tests against the in memory store and against real Postgres |
| TLS to a hosted database | Migration and all 49 tests over an encrypted connection |
| Transaction mode pooling | Migration, all 49 tests and all 20 acceptance checks through a real pgbouncer, the topology Supabase's pooled string uses |
| The deployed app | 20 acceptance checks over HTTP against a running deployment |
| Phone sized screens | Start screen and chat, at 375 wide |

## Deploying it yourself

```bash
vercel link
vercel env add DATABASE_URL production     # your Postgres connection string
vercel env add GEMINI_API_KEY production
DATABASE_URL="postgresql://..." npm run migrate
vercel deploy --prod
npm run verify -- https://your-deployment.vercel.app
```

On Supabase, take the **pooled** connection string, the one on port 6543. The driver is configured
with `prepare: false`, which is what Supabase documents for that endpoint.

Being precise about that, because it is the sort of claim people repeat without checking: the whole
suite has been run through a real pgbouncer in transaction mode, and prepared statements could **not**
be made to fail, with pooler side support both on and off. pgbouncer has replayed them since 1.21 and
`postgres.js` re-prepares when one goes missing. The setting stays because it is the documented safe
default and costs nothing here, not because it was proven necessary. What is verified is that the
app, the migration and all 49 tests work through transaction mode pooling.

Two more things that bite on Vercel specifically, both already handled here. `vercel deploy` ignores
`.gitignore` and uploads the working directory, so there is a `.vercelignore`. And a build is
rejected with a bare `BLOCKED` if git has no `user.email` configured.

## Verifying a deployment

The unit tests prove the rules. This proves the deployed thing:

```bash
npm run verify -- https://recall-memory-demo.vercel.app
```

Twenty checks over plain HTTP, exactly as a stranger's browser would talk to it. It stores a fact,
repeats it to prove nothing is written twice, ends the session, confirms the closed session refuses
further messages, starts a new one, asserts the answer is correct **and** that the payload carried
zero messages over from the session, checks a second person sees none of it, deletes everything and
confirms a later session genuinely no longer knows. It cleans up after itself, so it is safe to run
against production.

This is the definition of done expressed as code rather than as a paragraph.

### A note on free tier quotas, because it changed the design

The flagship `gemini-3.5-flash` gives a free tier key **twenty requests a day**, not a minute. I found
that the slow way: once it was spent, the API kept replying "please retry in about fifty seconds" and
never recovered across several minutes of honouring exactly that delay. Twenty a day is fine while
building and useless for a link a stranger might click.

So both calls are pinned to lite models, which carry far larger free allowances, and to two
*different* lite models, because quota is counted per model and one turn costs two requests. Putting
both on one model would halve the ceiling for nothing. The split is the right shape regardless:
extraction is a narrow schema constrained task at temperature zero, and answering someone about their
own life is where quality shows. On a billed key, `gemini-3.5-flash` is a good chat model and the
constant at the top of `src/lib/gemini.ts` is the only thing to change.

One related thing worth writing down. The request originally set `thinkingConfig` to switch off
thinking for latency. Newer models reject that outright with a generic "invalid argument", so a small
performance tweak had quietly become the reason the app could not be pointed at a current model, and
the error said nothing useful about why. It is gone. Optimisations that cost you portability and pay
you back in an opaque 400 are not worth keeping.

## Stack

Next.js and TypeScript, Postgres on Supabase, Gemini for extraction and for answering, deployed on
Vercel. Four runtime dependencies.

## License

MIT. See [LICENSE](LICENSE).
