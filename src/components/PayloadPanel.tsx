"use client";

import type { PayloadView, TurnReport } from "@/lib/client-types.ts";

/**
 * Panel two: what the model actually received.
 *
 * This is the proof, so it shows the request body verbatim rather than a
 * summary of it. The number that matters is "messages from this session". In a
 * new session it is zero, and any correct answer about the person therefore
 * came from the stored facts in the system instruction and from nowhere else.
 */
export function PayloadPanel({
  payload,
  report,
}: {
  payload: PayloadView | null;
  report: TurnReport | null;
}) {
  if (!payload) {
    return (
      <div className="panel-body">
        <p className="lede">
          Send a message and the exact request that went to the model appears here, in full.
        </p>
        <div className="empty">Nothing sent yet in this session.</div>
      </div>
    );
  }

  const { stats } = payload;

  return (
    <div className="panel-body">
      <p className="lede">
        The complete request body for the most recent turn, exactly as it was sent. No transcript is
        smuggled in. If the count below is zero, everything the answer knew about you was read back
        out of the database.
      </p>

      <div className="stat-row">
        <div className="stat">
          <div className={stats.transcriptMessages === 0 ? "n zero" : "n"}>
            {stats.transcriptMessages}
          </div>
          <div className="k">messages carried over from this session</div>
        </div>
        <div className="stat">
          <div className="n">{stats.memoriesIncluded}</div>
          <div className="k">stored facts written into the prompt</div>
        </div>
        <div className="stat">
          <div className="n">{stats.totalChars.toLocaleString()}</div>
          <div className="k">characters sent in total</div>
        </div>
      </div>

      {report ? <TurnNotes report={report} /> : null}

      <p className="section-title">Endpoint</p>
      <div className="endpoint">{payload.endpoint}</div>

      <p className="section-title">Request body, verbatim</p>
      <pre className="code">{JSON.stringify(payload.body, null, 2)}</pre>
    </div>
  );
}

function TurnNotes({ report }: { report: TurnReport }) {
  const { decisions, extraction, retrieval } = report;

  return (
    <>
      {!extraction.ok ? (
        <div className="banner warn">
          <b>Nothing was stored from that message</b>
          {extraction.message}
        </div>
      ) : null}

      <p className="section-title">What that message did to memory</p>
      {decisions.length === 0 ? (
        <div className="banner info">
          {extraction.ok
            ? "No durable fact in that message, so nothing was written. Questions and small talk are not stored."
            : "Extraction failed, so nothing was written."}
        </div>
      ) : (
        <div className="banner info">
          {decisions.map((decision, index) => (
            <div key={index}>{decision.description}</div>
          ))}
        </div>
      )}

      {retrieval.strategy === "ranked" ? (
        <div className="banner info">
          <b>
            {retrieval.activeCount} facts held, {retrieval.limit} sent
          </b>
          {retrieval.heldBack.length} were ranked lower and left out of this request. They are still
          stored and can be retrieved by a question that matches them.
        </div>
      ) : null}
    </>
  );
}
