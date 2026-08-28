"use client";

import { useState } from "react";
import type { StoredMemory } from "@/lib/memory/types.ts";

/**
 * Panel one: what is actually stored.
 *
 * Both halves are shown. The facts currently believed, and the facts they
 * replaced. Hiding the second half would make the supersede logic invisible,
 * and it is the most interesting thing the memory layer does.
 */
export function MemoryPanel({
  memories,
  onForget,
  busy,
}: {
  memories: StoredMemory[];
  onForget: (lineageId: string) => void;
  busy: boolean;
}) {
  const [showRetired, setShowRetired] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const active = memories.filter((m) => m.status === "active");
  const retired = memories.filter((m) => m.status === "superseded");

  return (
    <div className="panel-body">
      <p className="lede">
        Every fact held about you, extracted from what you typed and written to Postgres. Nothing
        here came from the current conversation staying open. Delete anything and it is gone from
        the database, not hidden.
      </p>

      {active.length === 0 ? (
        <div className="empty">
          Nothing stored yet. Tell it something about yourself and watch this fill up.
        </div>
      ) : (
        active.map((memory) => (
          <div className="mem" key={memory.id}>
            <div className="mem-top">
              <span className="attr">{memory.attribute}</span>
              <span className="spacer" />
              {confirming === memory.lineageId ? (
                <>
                  <button
                    className="btn tiny danger"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(null);
                      onForget(memory.lineageId);
                    }}
                  >
                    Delete for good
                  </button>
                  <button className="btn tiny" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                </>
              ) : (
                <button
                  className="btn tiny"
                  disabled={busy}
                  onClick={() => setConfirming(memory.lineageId)}
                >
                  Forget this
                </button>
              )}
            </div>
            <div className="mem-statement">{memory.statement}</div>
            <div className="mem-meta">
              <span>stored {formatWhen(memory.createdAt)}</span>
              <span>session {memory.sourceSessionId.slice(0, 8) || "unknown"}</span>
              {memory.mentionCount > 1 ? <span>told {memory.mentionCount} times</span> : null}
            </div>
          </div>
        ))
      )}

      {retired.length > 0 ? (
        <>
          <button className="btn tiny" onClick={() => setShowRetired((v) => !v)}>
            {showRetired ? "Hide" : "Show"} what was replaced ({retired.length})
          </button>
          {showRetired ? (
            <>
              <p className="lede">
                These were true when you said them and were replaced when you said something newer.
                They are kept as history and are never sent to the model. Deleting the current value
                deletes these with it.
              </p>
              {retired.map((memory) => (
                <div className="mem retired" key={memory.id}>
                  <div className="mem-top">
                    <span className="attr">{memory.attribute}</span>
                  </div>
                  <div className="mem-statement">{memory.statement}</div>
                  <div className="mem-meta">
                    <span>stored {formatWhen(memory.createdAt)}</span>
                    <span>replaced {formatWhen(memory.supersededAt)}</span>
                  </div>
                </div>
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function formatWhen(iso: string | null): string {
  if (!iso) return "unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
