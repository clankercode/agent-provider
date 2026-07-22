import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import {
  AGENT_PROVIDER_UI_MARKER,
  type PopupRequest,
  type PopupResponse,
  type PopupStatus,
} from "../../lib/ui-messages.js";

interface ActivePage {
  tabId: number;
  origin: string;
}

async function getActivePage(): Promise<ActivePage> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || tab.url === undefined) {
    throw new Error("No active web page.");
  }
  const url = new URL(tab.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("AgentProvider permissions apply only to HTTP(S) pages.");
  }
  return { tabId: tab.id, origin: url.origin };
}

async function send(request: PopupRequest): Promise<PopupStatus> {
  const response = (await browser.runtime.sendMessage(
    request,
  )) as PopupResponse;
  if (!response?.ok || response.status === undefined) {
    throw new Error(
      response?.error ?? "The AgentProvider background worker did not answer.",
    );
  }
  return response.status;
}

export function PopupApp() {
  const [page, setPage] = useState<ActivePage>();
  const [status, setStatus] = useState<PopupStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const active = await getActivePage();
    setPage(active);
    setStatus(
      await send({
        marker: AGENT_PROVIDER_UI_MARKER,
        type: "status",
        ...active,
      }),
    );
  }

  useEffect(() => {
    void refresh().catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, []);

  async function decide(
    decision: "grant-session" | "grant-persistent" | "revoke",
  ) {
    if (page === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      setStatus(
        await send({
          marker: AGENT_PROVIDER_UI_MARKER,
          type: "permission.set",
          ...page,
          decision,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function configureSession(patch: {
    mode?: "standard" | "audit-first";
    privateMode?: boolean;
  }) {
    if (page === undefined || status === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      setStatus(
        await send({
          marker: AGENT_PROVIDER_UI_MARKER,
          type: "session.set",
          ...page,
          mode: patch.mode ?? status.execution.mode,
          privateMode: patch.privateMode ?? status.execution.privateMode,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const granted =
    status?.permission === "granted-session" ||
    status?.permission === "granted-persistent";

  return (
    <main>
      <header>
        <span className="mark">AP</span>
        <div>
          <strong>Agent Provider</strong>
          <small>Extension authority</small>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {status ? (
        <>
          <section className="origin-plate">
            <span>Current origin</span>
            <code>{status.origin}</code>
          </section>
          <div className="health-grid">
            <div className="status-row">
              <span>Page access</span>
              <b className={granted ? "good" : "muted"}>{status.permission}</b>
            </div>
            <div className="status-row">
              <span>Provider</span>
              <b className={status.providerConfigured ? "good" : "warn"}>
                {status.providerConfigured ? "configured" : "needs setup"}
              </b>
            </div>
          </div>
          <section className="session-controls" aria-label="Session controls">
            <div>
              <span>Dispatch</span>
              <button
                className="compact"
                type="button"
                aria-pressed={status.execution.mode === "audit-first"}
                disabled={busy}
                onClick={() =>
                  void configureSession({
                    mode:
                      status.execution.mode === "audit-first"
                        ? "standard"
                        : "audit-first",
                  })
                }
              >
                {status.execution.mode === "audit-first"
                  ? "Audit-first"
                  : "Standard"}
              </button>
            </div>
            <div>
              <span>Session trace</span>
              <button
                className="compact"
                type="button"
                aria-pressed={status.execution.privateMode}
                disabled={busy}
                onClick={() =>
                  void configureSession({
                    privateMode: !status.execution.privateMode,
                  })
                }
              >
                {status.execution.privateMode ? "Private" : "Recorded"}
              </button>
            </div>
            <small className={status.audit.persistentError ? "warn" : "muted"}>
              {status.audit.persistentError
                ? "Persistent audit write needs attention"
                : `${status.audit.sessionEvents} session event${status.audit.sessionEvents === 1 ? "" : "s"}`}
            </small>
          </section>
          <div className="actions">
            {!granted ? (
              <>
                <button
                  disabled={busy}
                  onClick={() => void decide("grant-session")}
                >
                  Allow this tab
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void decide("grant-persistent")}
                >
                  Always allow
                </button>
              </>
            ) : (
              <button
                className="danger"
                disabled={busy}
                onClick={() => void decide("revoke")}
              >
                Revoke access
              </button>
            )}
          </div>
        </>
      ) : !error ? (
        <p>Reading this tab…</p>
      ) : null}

      <button
        className="link"
        type="button"
        onClick={() => void browser.runtime.openOptionsPage()}
      >
        Provider and model settings
      </button>
    </main>
  );
}
