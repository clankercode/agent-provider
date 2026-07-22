import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import {
  AGENT_PROVIDER_UI_MARKER,
  type PopupResponse,
  type PopupStatus,
  type ProviderApprovalPrompt,
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

async function getProviderApproval(
  approvalId: string,
): Promise<ProviderApprovalPrompt> {
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

async function decideProvider(
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
  const [providerApproval, setProviderApproval] =
    useState<ProviderApprovalPrompt>();
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
        : getProviderApproval(details.approvalId).then(setProviderApproval);
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
        await decideProvider(
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
            ? "This single model request may now dispatch. The approval cannot be reused."
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

  const providerPrompt = providerApproval !== undefined;
  const origin = providerApproval?.origin ?? details.origin;
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
              : "Page access request"}
          </p>
          <h1>
            {providerPrompt
              ? "Send this model request?"
              : "Let this origin use your model?"}
          </h1>
          <p className="lede">
            {providerPrompt
              ? "Audit-first mode pauses every dispatch here. This approval applies once and expires automatically."
              : "The page will receive model output through Agent Provider. Your API key remains inside extension storage."}
          </p>

          <div className="origin-plate">
            <span>Requesting origin</span>
            <code>{origin || "Unknown origin"}</code>
          </div>

          {!providerPrompt && details.reason ? (
            <blockquote>
              <span>Page-provided reason</span>
              {details.reason}
            </blockquote>
          ) : null}

          <dl>
            <div>
              <dt>{providerPrompt ? "Model alias" : "Model aliases"}</dt>
              <dd>
                {providerApproval?.alias ??
                  status?.aliases.join(", ") ??
                  "Configured aliases"}
              </dd>
            </div>
            <div>
              <dt>{providerPrompt ? "Execution mode" : "Provider"}</dt>
              <dd>
                {providerPrompt
                  ? "Audit-first · single use"
                  : status?.providerConfigured
                    ? "Ready"
                    : "Needs setup"}
              </dd>
            </div>
            <div>
              <dt>{providerPrompt ? "Request size" : "Credentials"}</dt>
              <dd>
                {providerPrompt
                  ? `${providerApproval.requestBytes.toLocaleString()} bytes`
                  : "Never exposed to page code"}
              </dd>
            </div>
          </dl>
        </div>

        <aside>
          <p className="kicker">
            {providerPrompt ? "One-time decision" : "Choose scope"}
          </p>
          <button
            className="primary"
            disabled={
              busy ||
              (providerPrompt ? !providerApproval : !details.permissionValid)
            }
            onClick={() =>
              void decide(providerPrompt ? "approved" : "grant-session")
            }
          >
            <span>{providerPrompt ? "Allow once" : "Allow this tab"}</span>
            <small>
              {providerPrompt
                ? "Consumed by this dispatch"
                : "Ends when the tab closes"}
            </small>
          </button>
          {!providerPrompt ? (
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
              busy ||
              (providerPrompt ? !providerApproval : !details.permissionValid)
            }
            onClick={() => void decide("deny")}
          >
            Deny request
          </button>
          <p className="boundary">
            {providerPrompt
              ? "Prompt content remains on the page; this surface shows authority metadata only."
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
