"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBanner } from "./Banner.tsx";
import { MemoryPanel } from "./MemoryPanel.tsx";
import { PayloadPanel } from "./PayloadPanel.tsx";
import { SessionPanel } from "./SessionPanel.tsx";
import type {
  ApiError,
  ChatResponse,
  PayloadView,
  SessionResponse,
  TurnReport,
} from "@/lib/client-types.ts";
import type { Person, Session, StoredMemory } from "@/lib/memory/types.ts";

const SESSION_KEY = "recall.sessionId";
const HANDLE_KEY = "recall.handle";
const PREVIOUS_KEY = "recall.previousSessionId";

type Phase = "booting" | "start" | "chatting" | "ended";
type Tab = "stored" | "payload" | "session";
interface Message {
  id: string;
  role: "user" | "model";
  text: string;
}

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await response.json()) as T | { error: ApiError };
  if (!response.ok) throw (data as { error: ApiError }).error;
  return data as T;
}

export function RecallApp() {
  const [phase, setPhase] = useState<Phase>("booting");
  const [handleInput, setHandleInput] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [previousSessionId, setPreviousSessionId] = useState<string | null>(null);
  const [memories, setMemories] = useState<StoredMemory[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [payload, setPayload] = useState<PayloadView | null>(null);
  const [report, setReport] = useState<TurnReport | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("stored");

  const messagesRef = useRef<HTMLDivElement>(null);

  // Resume on reload. A refreshed page is the same session, deliberately: only
  // the End session control creates a new one, so the demo cannot accidentally
  // look more impressive than it is.
  useEffect(() => {
    const saved = window.localStorage.getItem(SESSION_KEY);
    setHandleInput(window.localStorage.getItem(HANDLE_KEY) ?? "");
    setPreviousSessionId(window.localStorage.getItem(PREVIOUS_KEY));
    if (!saved) {
      setPhase("start");
      return;
    }
    call<SessionResponse>(`/api/session?id=${encodeURIComponent(saved)}`)
      .then((data) => {
        if (data.session.endedAt) {
          window.localStorage.removeItem(SESSION_KEY);
          setPhase("start");
          return;
        }
        setPerson(data.person);
        setSession(data.session);
        setMemories(data.memories);
        setMessages(data.turns.map((t) => ({ id: t.id, role: t.role, text: t.text })));
        setPayload(data.lastPayload);
        setPhase("chatting");
      })
      .catch(() => {
        window.localStorage.removeItem(SESSION_KEY);
        setPhase("start");
      });
  }, []);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const startSession = useCallback(async (handle: string) => {
    setBusy(true);
    setError(null);
    try {
      const data = await call<SessionResponse>("/api/session", {
        method: "POST",
        body: JSON.stringify({ handle }),
      });
      window.localStorage.setItem(SESSION_KEY, data.session.id);
      window.localStorage.setItem(HANDLE_KEY, data.person.handle);
      setPerson(data.person);
      setSession(data.session);
      setMemories(data.memories);
      setMessages([]);
      setPayload(null);
      setReport(null);
      setPhase("chatting");
      setTab("stored");
    } catch (thrown) {
      setError(thrown as ApiError);
    } finally {
      setBusy(false);
    }
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !session || busy) return;
    setDraft("");
    setError(null);
    setBusy(true);
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: "user", text }]);
    try {
      const data = await call<ChatResponse>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ sessionId: session.id, message: text }),
      });
      setMessages((prev) => [...prev, { id: `model-${Date.now()}`, role: "model", text: data.reply }]);
      setMemories(data.memories);
      setPayload(data.payload);
      setReport({ decisions: data.decisions, extraction: data.extraction, retrieval: data.retrieval });
    } catch (thrown) {
      setError(thrown as ApiError);
    } finally {
      setBusy(false);
    }
  }, [draft, session, busy]);

  const endSession = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await call(`/api/session?id=${encodeURIComponent(session.id)}`, { method: "DELETE" });
      window.localStorage.removeItem(SESSION_KEY);
      window.localStorage.setItem(PREVIOUS_KEY, session.id);
      setPreviousSessionId(session.id);
      setPhase("ended");
    } catch (thrown) {
      setError(thrown as ApiError);
    } finally {
      setBusy(false);
    }
  }, [session]);

  const forget = useCallback(
    async (lineageId: string) => {
      if (!person) return;
      setBusy(true);
      setError(null);
      try {
        const data = await call<{ memories: StoredMemory[] }>(
          `/api/memories?personId=${encodeURIComponent(person.id)}&lineageId=${encodeURIComponent(lineageId)}`,
          { method: "DELETE" },
        );
        setMemories(data.memories);
      } catch (thrown) {
        setError(thrown as ApiError);
      } finally {
        setBusy(false);
      }
    },
    [person],
  );

  if (phase === "booting") {
    return (
      <div className="shell">
        <Header />
        <div className="centre">
          <p className="lede">Loading.</p>
        </div>
      </div>
    );
  }

  if (phase === "start") {
    return (
      <div className="shell">
        <Header />
        <div className="centre">
          <form
            className="card"
            onSubmit={(event) => {
              event.preventDefault();
              void startSession(handleInput);
            }}
          >
            <h2>Tell it something. Then end the session and come back.</h2>
            <p>
              Most chat assistants forget you the moment the conversation closes. This one extracts
              what you told it, stores it, and reads it back in a session that starts completely
              empty. Every panel is open so you can check that is really what happened.
            </p>
            <ol className="steps">
              <li>Pick a name. There is no password and no sign up.</li>
              <li>Say something about yourself.</li>
              <li>End the session, which closes it in the database and issues a new id.</li>
              <li>Ask what it knows about you.</li>
            </ol>
            <input
              autoFocus
              value={handleInput}
              onChange={(event) => setHandleInput(event.target.value)}
              placeholder="A name to be known by"
              maxLength={32}
              aria-label="A name to be known by"
            />
            {error ? <ErrorBanner error={error} onDismiss={() => setError(null)} /> : null}
            <button className="btn primary" disabled={busy || handleInput.trim().length < 2}>
              {busy ? "Starting" : "Start a session"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (phase === "ended" || !session || !person) {
    return (
      <div className="shell">
        <Header />
        <div className="centre">
          <div className="card">
            <h2>That session is over.</h2>
            <p>
              It is closed in the database. The next one gets a new id and starts with an empty
              transcript, which you can confirm in the panel that shows what the model receives.
            </p>
            {previousSessionId ? (
              <div className="mem retired">
                <div
                  className="mem-statement"
                  style={{ fontFamily: "var(--mono)", fontSize: 13, textDecoration: "none" }}
                >
                  {previousSessionId}
                </div>
                <div className="mem-meta">
                  <span>ended</span>
                </div>
              </div>
            ) : null}
            <p>Start a new one and ask it what it knows about you.</p>
            {error ? <ErrorBanner error={error} onDismiss={() => setError(null)} /> : null}
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void startSession(handleInput)}
            >
              {busy ? "Starting" : `Start a new session as ${handleInput}`}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                window.localStorage.removeItem(SESSION_KEY);
                setPhase("start");
              }}
            >
              Use a different name
            </button>
          </div>
        </div>
      </div>
    );
  }

  const activeCount = memories.filter((m) => m.status === "active").length;

  return (
    <div className="shell">
      <Header>
        <span className="chip">
          <span className="dot" />
          <b>{person.handle}</b>
        </span>
        <span className="chip">
          session <code>{session.id.slice(0, 8)}</code>
        </span>
        <button className="btn danger" onClick={() => void endSession()} disabled={busy}>
          End session
        </button>
      </Header>

      <div className="split">
        <div className="pane">
          <div className="messages" ref={messagesRef}>
            {messages.length === 0 ? (
              <div className="empty">
                {activeCount > 0
                  ? "This session starts empty. Ask what it knows about you."
                  : "Say something about yourself. Watch the panel on the right."}
              </div>
            ) : null}
            {messages.map((message) => (
              <div className={`msg ${message.role}`} key={message.id}>
                <span className="who">{message.role === "user" ? person.handle : "recall"}</span>
                <div className="bubble">{message.text}</div>
              </div>
            ))}
            {busy ? (
              <div className="msg model">
                <span className="who">recall</span>
                <div className="bubble" style={{ color: "var(--dim)" }}>
                  Extracting, reconciling, retrieving.
                </div>
              </div>
            ) : null}
            {error ? <ErrorBanner error={error} onDismiss={() => setError(null)} /> : null}
          </div>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="Tell it something about yourself"
              rows={1}
              maxLength={2000}
              aria-label="Message"
            />
            <button className="btn primary" disabled={busy || draft.trim() === ""}>
              Send
            </button>
          </form>
        </div>

        <div className="pane">
          <div className="tabs" role="tablist">
            <button
              className="tab"
              role="tab"
              aria-selected={tab === "stored"}
              onClick={() => setTab("stored")}
            >
              Stored<span className="count">{activeCount}</span>
            </button>
            <button
              className="tab"
              role="tab"
              aria-selected={tab === "payload"}
              onClick={() => setTab("payload")}
            >
              Sent to the model
            </button>
            <button
              className="tab"
              role="tab"
              aria-selected={tab === "session"}
              onClick={() => setTab("session")}
            >
              Session
            </button>
          </div>

          {tab === "stored" ? (
            <MemoryPanel memories={memories} onForget={forget} busy={busy} />
          ) : null}
          {tab === "payload" ? <PayloadPanel payload={payload} report={report} /> : null}
          {tab === "session" ? (
            <SessionPanel
              person={person}
              session={session}
              turnCount={messages.length}
              previousSessionId={previousSessionId}
              onEnd={() => void endSession()}
              busy={busy}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="header">
      <div className="brand">
        <h1>recall</h1>
        <p>memory that outlives the session it was told in</p>
      </div>
      {children}
    </header>
  );
}
