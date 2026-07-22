import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import {
  AGENT_PROVIDER_UI_MARKER,
  type PopupResponse,
  type PopupStatus,
} from "../../lib/ui-messages.js";

type Decision = "grant-session" | "grant-persistent" | "deny";

function requestDetails() {
  const params = new URLSearchParams(location.search);
  const tabId = Number(params.get("tabId"));
  const origin = params.get("origin") ?? "";
  const reason = params.get("reason")?.slice(0, 300);
  return {
    tabId,
    origin,
    ...(reason === undefined ? {} : { reason }),
    valid: Number.isInteger(tabId) && tabId >= 0 && origin.length > 0,
  };
}

async function send(
  tabId: number,
  origin: string,
  decision?: Decision,
): Promise<PopupStatus> {
  const response = (await browser.runtime.sendMessage({
    marker: AGENT_PROVIDER_UI_MARKER,
    type: decision === undefined ? "status" : "permission.set",
    tabId,
    origin,
    ...(decision === undefined ? {} : { decision }),
  })) as PopupResponse;
  if (!response.ok || response.status === undefined) {
    throw new Error(
      response.error ?? "The extension did not accept this decision.",
    );
  }
  return response.status;
}

export function ApprovalApp() {
  const details = requestDetails();
  const [status, setStatus] = useState<PopupStatus>();
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState<Decision>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!details.valid) {
      setError("This permission request is invalid or has expired.");
      return;
    }
    void send(details.tabId, details.origin)
      .then(setStatus)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [details.origin, details.tabId, details.valid]);

  async function decide(decision: Decision) {
    setBusy(true);
    setError(undefined);
    try {
      setStatus(await send(details.tabId, details.origin, decision));
      setFinished(decision);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (finished !== undefined) {
    return (
      <main className="approval-shell approval-shell--finished">
        <div className="seal" aria-hidden="true">
          AP
        </div>
        <p className="kicker">Decision recorded</p>
        <h1>{finished === "deny" ? "Access denied" : "Access allowed"}</h1>
        <p className="lede">
          {finished === "grant-persistent"
            ? "This origin can use your configured model aliases until you revoke it."
            : finished === "grant-session"
              ? "This tab can use your configured model aliases for this session."
              : "No model authority was granted to the page."}
        </p>
        <button
          className="primary"
          type="button"
          onClick={() => window.close()}
        >
          Close window
        </button>
      </main>
    );
  }

  return (
    <main className="approval-shell">
      <header>
        <div className="brand">
          <div className="seal" aria-hidden="true">
            AP
          </div>
          <div>
            <strong>Agent Provider</strong>
            <span>Extension-owned authority prompt</span>
          </div>
        </div>
        <span className="trust-mark">Trusted surface</span>
      </header>

      <section className="decision-grid">
        <div className="request-copy">
          <p className="kicker">Page access request</p>
          <h1>Let this origin use your model?</h1>
          <p className="lede">
            The page will receive model output through Agent Provider. Your API
            key remains inside extension storage.
          </p>

          <div className="origin-plate">
            <span>Requesting origin</span>
            <code>{details.origin || "Unknown origin"}</code>
          </div>

          {details.reason ? (
            <blockquote>
              <span>Page-provided reason</span>
              {details.reason}
            </blockquote>
          ) : null}

          <dl>
            <div>
              <dt>Model aliases</dt>
              <dd>{status?.aliases.join(", ") || "Configured aliases"}</dd>
            </div>
            <div>
              <dt>Provider</dt>
              <dd>{status?.providerConfigured ? "Ready" : "Needs setup"}</dd>
            </div>
            <div>
              <dt>Credentials</dt>
              <dd>Never exposed to page code</dd>
            </div>
          </dl>
        </div>

        <aside>
          <p className="kicker">Choose scope</p>
          <button
            className="primary"
            disabled={busy || !details.valid}
            onClick={() => void decide("grant-session")}
          >
            <span>Allow this tab</span>
            <small>Ends when the tab closes</small>
          </button>
          <button
            className="secondary"
            disabled={busy || !details.valid}
            onClick={() => void decide("grant-persistent")}
          >
            <span>Always allow origin</span>
            <small>Revocable in settings</small>
          </button>
          <button
            className="deny"
            disabled={busy || !details.valid}
            onClick={() => void decide("deny")}
          >
            Deny request
          </button>
          <p className="boundary">
            Trust applies to the entire origin, including every script it runs.
          </p>
        </aside>
      </section>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}
