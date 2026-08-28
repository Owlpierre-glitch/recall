"use client";

import { useState } from "react";
import type { Person, Session } from "@/lib/memory/types.ts";

/**
 * Panel three: session identity.
 *
 * A cleared screen is not a new session. The id is shown in full so that the
 * one before and the one after ending can be compared, and so nobody has to
 * take the claim on trust.
 */
export function SessionPanel({
  person,
  session,
  turnCount,
  previousSessionId,
  onEnd,
  busy,
}: {
  person: Person;
  session: Session;
  turnCount: number;
  previousSessionId: string | null;
  onEnd: () => void;
  busy: boolean;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="panel-body">
      <p className="lede">
        Ending a session closes it in the database and issues a new id. Nothing from this
        conversation carries over except what was extracted and stored.
      </p>

      <p className="section-title">This session</p>
      <div className="mem">
        <div className="mem-statement" style={{ fontFamily: "var(--mono)", fontSize: 13 }}>
          {session.id}
        </div>
        <div className="mem-meta">
          <span>started {new Date(session.startedAt).toLocaleString()}</span>
          <span>
            {turnCount} message{turnCount === 1 ? "" : "s"} so far
          </span>
        </div>
        <div className="mem-top">
          <button
            className="btn tiny"
            onClick={() => {
              void navigator.clipboard?.writeText(session.id);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy id"}
          </button>
        </div>
      </div>

      {previousSessionId ? (
        <>
          <p className="section-title">The session before this one</p>
          <div className="mem retired">
            <div className="mem-statement" style={{ fontFamily: "var(--mono)", fontSize: 13, textDecoration: "none" }}>
              {previousSessionId}
            </div>
            <div className="mem-meta">
              <span>ended, and its transcript was never sent to this one</span>
            </div>
          </div>
        </>
      ) : null}

      <p className="section-title">Who you are here</p>
      <div className="mem">
        <div className="mem-statement">{person.handle}</div>
        <div className="mem-meta">
          <span>person {person.id.slice(0, 8)}</span>
          <span>first seen {new Date(person.createdAt).toLocaleDateString()}</span>
        </div>
      </div>

      <div className="banner warn">
        <b>There is no password, on purpose</b>
        Identity here is just the name you typed, which keeps a stranger from having to sign up to
        try the demo. It also means anyone who types the same name sees the same memories. Do not
        put anything private in here.
      </div>

      <button className="btn danger" onClick={onEnd} disabled={busy}>
        End this session
      </button>
    </div>
  );
}
