import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { decodeWireValue } from "@agent-provider/protocol";
import {
  AGENT_PROVIDER_UI_MARKER,
  type ApprovalPrompt,
  type PopupResponse,
  type PopupStatus,
} from "../../lib/ui-messages.js";

type PermissionDecision = "grant-session" | "grant-persistent" | "deny";
type FinishedDecision = PermissionDecision | "approved";

function requestDetails() {
  const params = new URLSearchParams(location.search);
  const approvalId = params.get("approvalId") ?? undefined;
  const tabId = Number(params.get("tabId"));
  const origin = params.get("origin") ?? "";
  const reason = params.get("reason")?.slice(0, 300);
  return {
    approvalId,
    tabId,
    origin,
    ...(reason === undefined ? {} : { reason }),
    permissionValid:
      approvalId === undefined &&
      Number.isInteger(tabId) &&
      tabId >= 0 &&
      origin.length > 0,
  };
}

async function sendPermission(
  tabId: number,
  origin: string,
  decision?: PermissionDecision,
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

async function getApproval(approvalId: string): Promise<ApprovalPrompt> {
  const response = (await browser.runtime.sendMessage({
    marker: AGENT_PROVIDER_UI_MARKER,
    type: "approval.get",
    approvalId,
  })) as PopupResponse;
  if (!response.ok || response.approval === undefined) {
    throw new Error(response.error ?? "This approval is no longer available.");
  }
  return response.approval;
}

async function decideApproval(
  approvalId: string,
  decision: "approved" | "denied",
): Promise<void> {
  const response = (await browser.runtime.sendMessage({
    marker: AGENT_PROVIDER_UI_MARKER,
    type: "approval.decide",
    approvalId,
    decision,
  })) as PopupResponse;
  if (!response.ok) {
    throw new Error(response.error ?? "The extension rejected this decision.");
  }
}

export function ApprovalApp() {
  const details = requestDetails();
  const [status, setStatus] = useState<PopupStatus>();
  const [approval, setApproval] = useState<ApprovalPrompt>();
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState<FinishedDecision>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const load =
      details.approvalId === undefined
        ? details.permissionValid
          ? sendPermission(details.tabId, details.origin).then(setStatus)
          : Promise.reject(
              new Error("This permission request is invalid or has expired."),
            )
        : getApproval(details.approvalId).then(setApproval);
    void load.catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [
    details.approvalId,
    details.origin,
    details.permissionValid,
    details.tabId,
  ]);

  async function decide(decision: FinishedDecision) {
    setBusy(true);
    setError(undefined);
    try {
      if (details.approvalId !== undefined) {
        await decideApproval(
          details.approvalId,
          decision === "approved" ? "approved" : "denied",
        );
      } else {
        setStatus(
          await sendPermission(
            details.tabId,
            details.origin,
            decision as PermissionDecision,
          ),
        );
      }
      setFinished(decision);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (finished !== undefined) {
    const denied = finished === "deny";
    return (
      <main className="approval-shell approval-shell--finished">
        <div className="seal" aria-hidden="true">
          AP
        </div>
        <p className="kicker">Decision recorded</p>
        <h1>{denied ? "Request denied" : "Request allowed"}</h1>
        <p className="lede">
          {finished === "approved"
            ? "This single step may now continue. The approval cannot be reused."
            : finished === "grant-persistent"
              ? "This origin can use your configured model aliases until you revoke it."
              : finished === "grant-session"
                ? "This tab can use your configured model aliases for this session."
                : "No new model authority was granted to the page."}
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

  const extensionPrompt = approval !== undefined;
  const providerPrompt = approval?.kind === "provider";
  const toolPrompt = approval?.kind === "tool";
  const origin = approval?.origin ?? details.origin;

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
          <p className="kicker">
            {providerPrompt
              ? "Provider dispatch approval"
              : toolPrompt
                ? "Tool callback approval"
                : "Page access request"}
          </p>
          <h1>
            {providerPrompt
              ? "Send this model request?"
              : toolPrompt
                ? `Run ${approval.toolName}?`
                : "Let this origin use your model?"}
          </h1>
          <p className="lede">
            {extensionPrompt
              ? "Audit-first pauses every provider and tool step here. This approval applies once and expires automatically."
              : "The page will receive model output through Agent Provider. Your API key remains inside extension storage."}
          </p>

          <div className="origin-plate">
            <span>Requesting origin</span>
            <code>{origin || "Unknown origin"}</code>
          </div>

          {!extensionPrompt && details.reason ? (
            <blockquote>
              <span>Page-provided reason</span>
              {details.reason}
            </blockquote>
          ) : null}

          <dl>
            <div>
              <dt>
                {providerPrompt
                  ? "Model alias"
                  : toolPrompt
                    ? "Declared risk"
                    : "Model aliases"}
              </dt>
              <dd>
                {providerPrompt
                  ? approval.alias
                  : toolPrompt
                    ? approval.risk
                    : status?.aliases.join(", ") || "Configured aliases"}
              </dd>
            </div>
            <div>
              <dt>{extensionPrompt ? "Execution mode" : "Provider"}</dt>
              <dd>
                {extensionPrompt
                  ? "Audit-first · single use"
                  : status?.providerConfigured
                    ? "Ready"
                    : "Needs setup"}
              </dd>
            </div>
            <div>
              <dt>
                {providerPrompt
                  ? "Request size"
                  : toolPrompt
                    ? "Normalized input"
                    : "Credentials"}
              </dt>
              <dd>
                {providerPrompt
                  ? `${approval.requestBytes.toLocaleString()} bytes`
                  : toolPrompt
                    ? "Shown below"
                    : "Never exposed to page code"}
              </dd>
            </div>
          </dl>

          {toolPrompt ? (
            <pre className="tool-input">
              {JSON.stringify(decodeWireValue(approval.input), null, 2)}
            </pre>
          ) : null}
        </div>

        <aside>
          <p className="kicker">
            {extensionPrompt ? "One-time decision" : "Choose scope"}
          </p>
          <button
            className="primary"
            disabled={
              busy || (extensionPrompt ? !approval : !details.permissionValid)
            }
            onClick={() =>
              void decide(extensionPrompt ? "approved" : "grant-session")
            }
          >
            <span>{extensionPrompt ? "Allow once" : "Allow this tab"}</span>
            <small>
              {extensionPrompt
                ? "Consumed by this step"
                : "Ends when the tab closes"}
            </small>
          </button>
          {!extensionPrompt ? (
            <button
              className="secondary"
              disabled={busy || !details.permissionValid}
              onClick={() => void decide("grant-persistent")}
            >
              <span>Always allow origin</span>
              <small>Revocable in settings</small>
            </button>
          ) : null}
          <button
            className="deny"
            disabled={
              busy || (extensionPrompt ? !approval : !details.permissionValid)
            }
            onClick={() => void decide("deny")}
          >
            Deny request
          </button>
          <p className="boundary">
            {providerPrompt
              ? "Prompt content remains on the page; this surface shows authority metadata only."
              : toolPrompt
                ? "Tool input is shown for this decision and is not retained in the metadata audit."
                : "Trust applies to the entire origin, including every script it runs."}
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
