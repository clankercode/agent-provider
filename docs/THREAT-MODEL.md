# Agent Provider threat model

## Assets and boundaries

Protected assets are provider API keys, configured endpoints and aliases,
origin grants, approval decisions, budgets, and private/audit metadata. The
extension background context is authoritative for these assets. Page and
content-script messages are untrusted input.

The application page is authoritative for application business actions. The
extension cannot replace application authentication or authorization. A grant
trusts every script capable of executing on the exact origin.

## Required controls

This section is the target security contract. The release candidate enforces
these controls; the remaining verification and lifecycle gaps are maintained in
[implementation status](IMPLEMENTATION-STATUS.md) and
[future concerns](FUTURE-CONCERNS.md).

- Exact runtime sender-origin derivation and build-time application coverage.
- Stable bootstrap plus versioned, bounded, correlated messages.
- Extension-owned credentials and provider fetches; no arbitrary page headers,
  provider URLs, or provider-executed tools.
- Canonical endpoint validation, exact destination checks, and no redirects.
- Mandatory tool risk and schemas; page approval for mutation; extension
  approval for every audit-first provider/tool step.
- Single-use approval records bound to origin/session/request and canonical
  payload/declaration hashes.
- Reserve/settle budgets, timeouts, concurrency limits, cancellation, and no
  replay after an unknown post-dispatch outcome.
- Context roots, sensitive-control exclusion, application redaction, bounded
  immutable frames, and explicit truncation.
- Metadata-only audit by default; private mode never persists.
- Scrubbing of provider headers, bodies, raw chunks, keys, and credential-like
  metadata before any page-visible result.

## Tool-author checklist

- Keep tools narrow, typed, and named as concrete actions.
- Recheck user/session/tenant authorization on the application server.
- Use the supplied idempotency key for consequential mutations.
- Make destructive consequences and reconciliation steps visible to users.
- Return minimum necessary results and never echo secrets.
- Treat model input as untrusted; validate ownership, state transitions, and
  business limits independently.
- Document what happens when a callback's outcome becomes unknown.

## Known limits

- A malicious granted origin can spend within configured policy and propose its
  declared tools; origin security and CSP remain prerequisites.
- Browser extension-local storage is not an operating-system credential vault.
- Cancellation after dispatch is best effort; `outcome-unknown` requires
  provider or application reconciliation.
- Provider privacy and retention are governed by the user's provider account.
- Browser-worker restart conservatively accounts for dispatched model work, but
  the short-lived tool execution-report correlation map is not durable. A tool
  callback that outlives a worker restart may be reported as unknown rather than
  completed in extension audit.
- Custom HTTPS bridge activation is user-mediated and exact-origin, but its
  browser permission gesture is not yet covered by an automated end-to-end
  scenario.
- The security review was single-agent; independent review remains a release
  hardening recommendation.
