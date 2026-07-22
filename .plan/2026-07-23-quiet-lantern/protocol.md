# Page-extension protocol

## Envelope

Every post-handshake cross-boundary message is a safe, bounded object containing:

- channel `agent-provider.bridge`;
- protocol version and supported version range during handshake;
- direction (`page-to-extension` or `extension-to-page`);
- client, session, request, and optional run/tool-call identifiers;
- message type and validated payload.

Handshake uses these permanently stable version-0 JSON objects:

```text
Hello  = { channel, bootstrap: 0, type: "hello",
           direction: "page-to-extension", clientId,
           supported: { min, max } }
Ready  = { channel, bootstrap: 0, type: "ready",
           direction: "extension-to-page", clientId, sessionId,
           selectedVersion, capabilities }
Reject = { channel, bootstrap: 0, type: "reject",
           direction: "extension-to-page", clientId,
           code: "NO_VERSION_OVERLAP" | "INVALID_BOOTSTRAP" }
```

`channel` is always `agent-provider.bridge`; protocol versions are integers from
1 through 65,535 with `min <= max`; identifiers use the protocol ID grammar;
`Ready.selectedVersion` is the highest overlap and establishes the session.
The extension emits exactly one Ready or Reject for a valid client/hello pair.
All later messages use the selected version and session ID. Unknown versions,
directions, types, reserved codec tags, duplicate terminal messages, oversized
payloads, malformed identifiers, and messages from a stale origin/session fail
closed with a structured bridge error.

## Lifecycle messages

- Bootstrap `hello` / `ready` negotiate protocol and capabilities before v1
  lifecycle messages are accepted.
- `access.query` / `access.request` / `access.result` cover exact-origin grants.
- `model.generate` starts one bounded request; `model.stream` carries normalized
  public parts; `model.complete` terminates it; `model.cancel` is idempotent.
- `provider.approval.request` / `provider.approval.result` govern audit-first
  provider dispatch. The immutable record binds exact origin, tab, client,
  session, request, mode, alias fingerprint, canonical normalized dispatch-
  payload hash, decision, and expiry.
- `tool.extension-approval.request` / `tool.extension-approval.result` govern
  audit-first tool callbacks. The immutable record binds exact origin, tab,
  client, session, run, request, tool call, tool name, declared risk, canonical
  declaration/schema/input hash, decision, and expiry.
- `tool.execution.report` returns callback state to extension audit. Page-native
  approvals remain runtime-local and are never confused with extension
  authority.
- `bridge.error` carries a stable code, safe message, retryability, and
  identifiers, without raw provider transport details.

Approval hashes use SHA-256 over the UTF-8 encoding of the safe-value codec's
canonical JSON: object keys sorted lexicographically, no insignificant
whitespace, and tagged non-JSON values normalized before hashing. The
authoritative extension store atomically compares and consumes an approved
record once; mismatch, duplicate use, expiry, navigation, or session change
denies dispatch. Model tool-call parts may be displayed by the page before
extension approval, but no callback may execute without the consumed token and
any required page-native approval.

Provider requests and callbacks use the same observable states with separate
instances:

| State              | Terminal | Meaning                                                        |
| ------------------ | -------- | -------------------------------------------------------------- |
| `queued`           | no       | No external work has been dispatched.                          |
| `dispatched`       | no       | External work may have begun.                                  |
| `cancel-requested` | no       | Abort was signalled after dispatch; completion may still race. |
| `cancelled`        | yes      | Cancellation was proven before dispatch/no external effect.    |
| `completed`        | yes      | A successful result was observed.                              |
| `failed`           | yes      | A definitive failure was observed.                             |
| `outcome-unknown`  | yes      | Post-dispatch terminal outcome could not be established.       |

Allowed transitions are `queued -> dispatched | cancelled | failed`, `dispatched ->
cancel-requested | completed | failed | outcome-unknown`, and
`cancel-requested -> completed | failed | outcome-unknown`. A race resolves to
the first definitive terminal event recorded by the owner of the operation;
later terminal events are diagnostic duplicates and do not replace the run's
single terminal result. On disconnect/timeout after dispatch, the state becomes
`outcome-unknown`. Reconnection never replays uncertain work. Consequential
callbacks receive an idempotency key and must provide application-specific
reconciliation guidance.

The `queued -> failed` transition covers definitive pre-dispatch rejection or
setup failure, including permission/policy denial, approval denial or expiry,
schema/limit validation failure, unavailable provider configuration, and bridge
setup failure. No external provider request or page callback has begun in this
case.

## Model contract

The page supplies a logical alias, normalized conversation messages, declared
page tools, and conservative generation limits. The extension rejects provider
names, arbitrary URLs, headers, provider-executed tools, and options outside the
public allowlist. Provider adapters emit normalized text, reasoning summaries
where policy permits, page-tool calls, usage, finish reasons, and safe errors.

The safe-value codec supports JSON values plus explicitly tagged bytes, bigint,
date, and undefined representations. It rejects cycles, prototypes, functions,
symbols, accessors, excessive nesting/size, and collisions with its reserved
`$agentProvider` tag.

## Compatibility

The operational protocol starts at version 1 after the stable version-0
bootstrap selects the highest overlap. Additive optional fields require no
version bump; changed meaning,
removed fields, or new required fields require a new version and compatibility
tests. The runtime and extension expose their supported ranges in diagnostics.
