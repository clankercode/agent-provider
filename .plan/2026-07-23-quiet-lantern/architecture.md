# Architecture

## Trust boundary

An exact page origin is one trust principal. Agent Provider protects extension
credentials and provider authority from ordinary page JavaScript, but it does
not claim to sandbox a malicious script already running on a granted origin.
Tool callbacks must continue to enforce application authorization and business
invariants.

## Workspace modules

- `@agent-provider/protocol`: versioned envelopes, normalized model messages,
  safe-value codec, guards, structured errors, and correlation identifiers.
- `@agent-provider/context`: DOM extraction, regions, forms, redaction,
  immutable frames, revision deltas, and deterministic limits.
- `@agent-provider/runtime`: bridge lifecycle, runs, tool execution, approval,
  context refresh, cancellation, and observable state.
- `@agent-provider/ai-sdk`: an advanced AI SDK `LanguageModel` backed by the
  extension bridge.
- `@agent-provider/react`: framework bindings and a reference chat surface.
- `@agent-provider/webmcp`: optional tool exposure adapter.
- `apps/extension`: WXT extension authority, provider adapters, policy, grants,
  credentials, audit, popup, approval window, and settings.
- `examples/operations-dashboard`: read/write/destructive, form, region,
  redaction, cancellation, denial, and failure demonstrations.

## Stable page API

`createAgentRuntime(options)` returns one lifecycle object with `connect`,
`requestAccess`, `send`, `subscribe`, `resolveApproval`, `cancel`, and `destroy`.
Expected failures are discriminated outcomes. A run has a stable identifier,
abort signal, observable events, and one terminal result.

Every tool has a name, description, AI SDK-compatible input schema, optional
output schema, mandatory `read | write | destructive` risk, and an abort-aware
callback. Mutation approval cannot be disabled by page configuration. Inputs
and declared outputs are validated and serialized through bounded safe values.

`createAgentProviderModel({ alias })` returns the supported AI SDK public
`LanguageModel` type. This is the deliberate advanced escape hatch; it does not
expose provider credentials or provider-specific HTTP controls.

## Context module

`createPageContext` accepts root functions evaluated at capture time, optional
named regions, redaction predicates, explicit extractors, and limits. Captures
produce immutable `ContextFrame` values with a revision, capture timestamp,
Markdown-oriented content, region metadata, applied redactions, and truncation
metadata. Deltas name their base and next revisions and contain changed/removed
regions rather than DOM nodes.

Default limits are 32 KiB of rendered UTF-8, DOM depth 32, 128 regions, and
4 KiB per ordinary form value. Password, file, hidden, payment, OTP, token-like,
and explicitly redacted controls are excluded unless a deliberate extractor
supplies a safe replacement.

The runtime can refresh before each user turn or model step. A model step sees
one immutable frame; changes observed during it become visible only at the next
boundary.

## Extension authority

The extension derives the sender origin and rechecks deployment eligibility,
grant, alias, mode, budgets, and request bounds for every provider call.
Provider keys stay in extension-local non-sync storage or memory-only session
storage. The page can never supply headers or select an arbitrary provider.

The toolbar popup reports the current origin and pending work. An
extension-owned window handles origin/model consent and audit-first approvals.
The settings page manages provider profiles, aliases, grants, budgets, audit,
revocation, and deletion. Standard-mode mutation tools additionally require a
page-native approval before their callbacks run.

Provider adapters are real internal modules because the three selected wire
families differ. They normalize streaming, tool calls, usage, cancellation,
timeouts, and errors before results enter the bridge. Raw headers, bodies,
chunks, and credential-like metadata are scrubbed.

Application origins and provider-network origins are separate permission
surfaces. V1 application origins come from a build-time exact-origin allowlist;
WXT emits the narrowest browser-supported `content_scripts.matches` entries for
them. Production application origins use HTTPS with the default port. Chrome
may represent explicit ports; Firefox match patterns cannot, so non-default
ports are supported only for loopback development and are always narrowed by a
runtime sender-origin equality check. IPv6 application origins are rejected in
v1. Adding an application origin requires a new configured build. The extension
then applies an independent user grant keyed by exact runtime origin, allowed
alias identifiers, alias configuration fingerprints, minimum-strictness base
mode, scope, and expiry.

An alias fingerprint is SHA-256 over canonical safe JSON containing provider
family, provider-profile identifier, canonical endpoint origin and base path,
model identifier, and every authority-expanding provider or generation option.
Key rotation and policy tightening do not change it. Alias remapping, endpoint
change, authority expansion, or any grant-scope broadening invalidates the
affected grant until extension-owned reconfirmation.

Provider endpoints use this algorithm:

1. Parse with the platform WHATWG `URL`; reject parse failure, username,
   password, query, fragment, and IPv6 zone identifiers.
2. Require HTTPS. Permit HTTP only when `hostname` is exactly `localhost`,
   `127.0.0.1`, or `[::1]`; DNS names that resolve to loopback do not qualify.
3. Use WHATWG's ASCII/IDNA hostname, lower-case protocol/hostname, remove a
   default port, normalize dot segments, preserve a non-root base path, and
   serialize it with exactly one trailing slash. Reject encoded slash or
   backslash path segments.
4. Join adapter-owned relative paths without a leading slash against that base;
   reject a result that escapes the canonical base path.
5. Immediately before attaching credentials, require exact equality with the
   configured/granted serialized origin and the expected base-path prefix.
   Every provider fetch uses `redirect: "manual"`; all redirect responses fail.

Firefox may need host-level optional manifest coverage for a custom endpoint
with a non-default port, but the active runtime grant, destination check, and
credential attachment remain bound to the exact serialized origin. Tests and
UI distinguish manifest coverage from runtime authority.

## Persistence and policy

Policy resolution applies defaults, then user global policy, provider/alias
policy, origin policy, session restrictions, and eventually managed policy.
Each later layer may only tighten the effective policy. Quotas use reserve and
settle accounting so concurrent requests cannot overspend a limit.

Session audit is metadata-only. Persistent audit is opt-in and stored in
extension IndexedDB, capped by 30 days, 10,000 events, or 10 MiB, with oldest
events removed at the first reached limit. These are hard v1 defaults; users
may tighten retention but cannot raise the hard cap. Private mode never
persists audit.

The initial advanced compatibility contract is AI SDK 7.x (`ai >=7.0.34 <8`)
and provider interface 4.x (`@ai-sdk/provider ^4.0.3`). CI compiles consumer
fixtures against the minimum and latest allowed 7.x versions.
