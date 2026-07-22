# User control and audit

## Intent

The extension is not merely a hidden credential relay.  It is the user's
control surface for deciding which sites may invoke a model, how autonomously a
run may proceed, and what local record remains afterwards.  Page UI can explain
and initiate a request, but it cannot stand in for extension-mediated consent.

## Permission to start an agent

When a page first asks to run an agent for an origin without an active grant,
the user must receive meaningful consent through an extension-controlled
surface.  Browser chrome (toolbar popup or side panel) is a strong default; an
in-page prompt is acceptable only when it is visibly extension-provided and
does not weaken the consent information or scope controls below.  The exact UI
surface is an implementation decision.

The permission surface must show:

- the exact requesting origin, never a page-supplied display name as the sole
  identity;
- the application-provided name, if available, clearly marked as descriptive;
- whether a provider is configured and the logical model alias requested;
- the execution mode that will apply;
- whether the grant is for this tab/session or persists for the origin;
- a concise description of what may be sent to the provider: prompts, selected
  page context, tool schemas, and tool results; and
- clear Allow, Deny, and Cancel actions.

The user can grant only the current tab/session or the exact origin.  A denial,
expiration, navigation to a different origin, extension disablement, or explicit
revocation prevents new provider requests.  The page receives a structured
permission error, not an ambiguous timeout.

## Execution approval

Standard mode relies on the page runtime's tool-risk policy: reads run by
default, while writes and destructive operations require a page-native approval
before the callback.  The approval UI must include tool name, plain-language
description, normalized input, and enough application context to make the
decision intelligible.  Denial, timeout, cancellation, or navigation produces a
structured tool result and does not execute the callback.

**Audit-first mode** is deliberately stricter.  Before every provider request,
the extension-controlled approval flow obtains the user's approval or denial.
Before every proposed tool call—including a read—it does the same, identifying
the tool, declared risk, normalized arguments, and current origin.  Approval is
single-use and bound to the relevant execution context; it cannot be reused
after navigation or for a different call.  The page callback runs only after
both this approval and any page-native approval required by the tool's policy.

The request preview should expose a safe summary rather than automatically
rendering the entire prompt.  Users need a way to view the exact normalized
payload before approval when they choose, with sensitive fields redacted
according to application and extension policy.

## Audit record model

The extension maintains a per-origin audit view.  By default it retains a
minimal, local record for the current browser session only; persistent logging
is opt-in per origin and clearly indicated.  Private sessions are never written
to persistent audit storage.

An audit event records metadata sufficient to answer “what happened?” without
retaining prompt or application content by default:

| Event | Minimum fields |
| --- | --- |
| Permission decision | time, origin, grant scope, decision, selected mode |
| Model request | time, origin, alias, request ID, execution mode, decision, size/limit outcome, duration, provider result status and usage when available |
| Tool proposal | time, origin, run/request ID, tool name, declared risk, approval decision, execution status and duration |
| Policy or bridge failure | time, origin when known, error class/code, affected request ID |
| Audit setting/deletion | time, origin or all-origins scope, setting/action, result |

Prompt text, page snapshots, tool arguments/results, raw provider responses,
credentials, and provider HTTP metadata are excluded by default.  If a future
policy permits content capture, it must be a separate explicit setting with a
retention period, redaction rules, export semantics, and a clear warning that it
may contain sensitive application data.

## Audit-log controls

For the current origin, the extension must let the user:

- inspect recent session and persistent events, clearly marked by storage type;
- enable or disable persistent audit logging for future events;
- start a private session, with an unambiguous active-state indicator;
- delete all persistent records for that origin; and
- revoke the origin grant independently of deleting its audit history.

The extension must also offer a global view to list origins with stored logs,
delete one origin's records, and delete all persistent audit records.  Deletion
is destructive and requires confirmation.  It must remove locally stored events
and associated indexes/derived summaries; it cannot promise deletion from an
external provider's systems or from separately managed enterprise telemetry.

## Privacy and reliability rules

Audit storage is local extension data by default and must be protected from page
and content-script access.  Failed writes must not block or alter the model/tool
operation; the extension should surface a local “audit recording failed” status
and record it when storage becomes available.  Conversely, a policy configured
to require auditing may fail closed before a model request where a compliant
record cannot be made.

Retention, storage quota behavior, export, managed enterprise logging, and
cross-device synchronization are explicit future decisions.  None should be
inferred from the existence of a local audit view.
