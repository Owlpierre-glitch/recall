-- recall: schema
--
-- Run once against your Postgres database:  npm run migrate
--
-- Two things in here are load bearing and worth reading before changing:
--
-- 1. recall_memories_active_fingerprint. Idempotency is enforced by the
--    database, not only by application code. Two servers handling the same
--    message at the same time cannot both insert the same fact.
-- 2. source_session_id is ON DELETE SET NULL, never CASCADE. A memory has to
--    outlive the session that produced it. That is the entire point of the
--    project, so the foreign key is not allowed to be the thing that breaks it.

create table if not exists recall_people (
  id          uuid primary key,
  handle      text not null,
  -- Lowercased handle. Two people cannot claim the same name in different case.
  handle_key  text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists recall_sessions (
  id          uuid primary key,
  person_id   uuid not null references recall_people (id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);

create table if not exists recall_memories (
  id                uuid primary key,
  person_id         uuid not null references recall_people (id) on delete cascade,
  attribute         text not null,
  statement         text not null,
  fingerprint       text not null,
  status            text not null check (status in ('active', 'superseded')),
  -- Groups a fact with everything it replaced, so deleting a memory can take
  -- its whole history with it rather than leaving the old value in the table.
  lineage_id        uuid not null,
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  mention_count     integer not null default 1,
  source_session_id uuid references recall_sessions (id) on delete set null,
  superseded_by_id  uuid references recall_memories (id) on delete set null,
  superseded_at     timestamptz
);

create unique index if not exists recall_memories_active_fingerprint
  on recall_memories (person_id, fingerprint)
  where status = 'active';

create index if not exists recall_memories_person
  on recall_memories (person_id, status);

create index if not exists recall_memories_lineage
  on recall_memories (person_id, lineage_id);

create table if not exists recall_turns (
  id          uuid primary key,
  session_id  uuid not null references recall_sessions (id) on delete cascade,
  role        text not null check (role in ('user', 'model')),
  text        text not null,
  -- The exact request body sent to the model for this turn. Stored so the proof
  -- panel survives a page reload, and so any past turn can be inspected rather
  -- than only the one still on screen.
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists recall_turns_session
  on recall_turns (session_id, created_at);
