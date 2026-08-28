import type { ApiError } from "@/lib/client-types.ts";

/**
 * Errors are shown, never swallowed. A provider failure names the provider, the
 * model and the status code, so "it stopped working" can be diagnosed from the
 * screen rather than from the server logs.
 */
export function ErrorBanner({ error, onDismiss }: { error: ApiError; onDismiss?: () => void }) {
  const provider = error.model ? `${error.provider ?? "provider"} / ${error.model}` : null;
  return (
    <div className="banner error" role="alert">
      <b>{titleFor(error.code)}</b>
      {error.message}
      {provider ? (
        <div style={{ marginTop: 6, fontSize: 12 }}>
          <code>
            {provider}
            {error.status ? ` / HTTP ${error.status}` : ""} / {error.code}
          </code>
        </div>
      ) : null}
      {onDismiss ? (
        <div style={{ marginTop: 9 }}>
          <button className="btn tiny" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}

function titleFor(code: string): string {
  switch (code) {
    case "MODEL_UNAVAILABLE":
      return "The pinned model is gone";
    case "MISSING_API_KEY":
      return "The server has no API key";
    case "MISSING_DATABASE_URL":
      return "The server has no database";
    case "RATE_LIMITED":
      return "Rate limited by the provider";
    case "SESSION_ENDED":
      return "That session is over";
    case "NETWORK":
      return "Could not reach the server";
    case "BAD_RESPONSE":
      return "The server answered with something unreadable";
    default:
      return "Something failed, and here is what";
  }
}
