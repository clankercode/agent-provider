# Future concerns and explicit stubs

This is the durable queue for work intentionally deferred from the current
alpha. The order reflects safety and delivery impact.

## P0: required before a production claim

1. Wire `QuotaLedger` around every background provider dispatch. Persist
   per-origin settled usage safely across MV3 worker restarts, reserve the
   maximum authorized output before dispatch, settle normalized provider usage,
   and reconcile unknown outcomes without replay.
2. Add protocol and background state for `standard | audit-first` plus
   orthogonal private sessions. Audit-first must require extension-owned,
   single-use approval before every provider request and proposed tool callback.
3. Wire `AuditRecorder` and its IndexedDB store to permission, model, tool,
   policy, bridge, setting, and deletion events. Add origin/global inspection,
   persistent opt-in, private-mode exclusion, deletion, and visible write-failure
   state to extension UI.
4. Bind page tool execution reports to extension approvals and canonical
   declaration/schema/input hashes. Mutation callbacks must continue to require
   page-native application approval independently.
5. Add integrated browser tests for grant/deny/revoke, live generation and
   streaming through the extension, cancellation, timeout, navigation,
   disconnect, service-worker restart, and outcome-unknown no-replay behavior.
6. Complete a focused extension/application security review and dependency
   update-chain review after these lifecycle controls are wired.

## P1: release and parity work

- Run the browser smoke suite in Firefox rather than relying on a clean build.
- Add packed consumer tests for headless, React, advanced AI SDK, and WebMCP
  imports, then publish/sign browser and npm artifacts.
- Add a separately authorized Gemini live smoke; current Gemini verification is
  fixture-only.
- Add managed policy as a tightening-only layer when a deployment needs it.
- Finalize provider terms, privacy disclosures, product naming, store metadata,
  extension IDs, and signing credentials.

## Deliberately unsupported

Safari is not a v1 blocker and is currently unsupported. Chrome is required;
Firefox is the next parity target.
