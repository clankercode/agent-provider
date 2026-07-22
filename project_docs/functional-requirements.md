# Functional requirements

This document is a build-oriented baseline of **outcomes**, not an architecture
specification. “Must” describes a user-visible guarantee, authority rule, or
verification property that the first complete implementation preserves.
“Should” describes a preferred outcome where the exact behavior remains open.

An implementer may choose different package/module boundaries, browser UI
surfaces, protocol messages, storage engines, DOM-parsing libraries, and
provider adapters. It may also combine modules described here when doing so
keeps the same authority separation and testable behavior. It must not use an
implementation choice to weaken the stated outcome.

## Page integration and runtime

- **FR-1:** A page must be able to create an agent runtime with instructions,
  suggestions, a logical model alias, typed tools, and optional current-page
  context configuration.
- **FR-2:** Each tool must declare a name, description, input schema, callback,
  and risk class (`read`, `write`, or `destructive`). Inputs must be schema
  validated before callback execution.
- **FR-3:** The runtime must support a supplied UI and a headless integration;
  neither UI choice changes extension policy or tool semantics.
- **FR-4:** The runtime must make pending model work and proposed/running tool
  calls observable to the host UI, and must support cancellation.
- **FR-5:** It must return structured outcomes for permission denial, policy
  denial, provider failure, timeout, cancellation, bridge loss, and rejected
  tool input rather than treating them as normal model text.

## Context module

- **FR-6:** The page may identify one or more current main-content roots through
  a mechanism evaluated at context-request time, not only at initial mount.
- **FR-7:** The module must turn only configured roots into a bounded textual
  snapshot; it must never imply access to arbitrary page DOM.
- **FR-8:** It must support named regions and expose operations to list regions,
  retrieve a named region, and retrieve a full snapshot.
- **FR-9:** It should detect ordinary form structure and values, but explicit
  extractors and redaction rules must override automatic extraction.
- **FR-10:** Snapshot generation must have configurable size/depth limits,
  deterministic truncation reporting, and no implicit persistence of raw DOM.

## Extension and provider bridge

- **FR-11:** The extension must own provider credentials and provider network
  calls. Neither credentials nor extension storage contents may be sent to
  page code or content scripts.
- **FR-12:** A page may request only configured logical aliases. The extension
  must map aliases to provider/model policy and reject arbitrary provider
  headers, provider-specific options, and provider-executed tools.
- **FR-13:** The extension must derive the origin from browser sender/tab
  context, require both deployment allowlisting and a user grant, and recheck
  permission for every model request.
- **FR-14:** Communication across the page/extension seam must be compatible
  across intended versions, validate untrusted input, bound work/data, support
  correlation, cancellation, and timeout, and fail closed on disconnect. A
  versioned wire protocol is the expected implementation, not the only one.
- **FR-15:** Before results reach page code, the extension must remove raw
  transport bodies/headers/chunks and redact credential-like metadata.
- **FR-24:** Extension settings must provide first-class OpenAI-compatible,
  Anthropic-compatible, and Gemini profile endpoint presets while retaining
  custom endpoints. A user must be able to pull a bounded model catalog from a
  configured provider on demand and apply a discovered model to an alias;
  credentials and raw provider error bodies must remain extension-owned, and
  manual model identifiers must remain available when discovery is unsupported.

## Permission, execution, and audit

- **FR-16:** An ungranted page request to start an agent must receive meaningful
  consent through an extension-controlled surface, with the information and
  scopes defined in [User control and audit](user-control-and-audit.md).
- **FR-17:** The extension must support standard, audit-first, and private
  session modes; audit-first requires approval of every provider request and
  every tool call.
- **FR-18:** A write/destructive callback must not execute without the runtime's
  required page-native approval. In audit-first mode it must also have a
  matching, single-use extension approval.
- **FR-19:** The extension must provide an origin-scoped audit view, opt-in
  persistent audit storage, private sessions, origin/global deletion controls,
  and independent grant revocation.
- **FR-20:** Default audit records must be metadata-only as defined in the audit
  document; content capture, enterprise export, or synchronization require
  separate explicit configuration.

## Verification baseline

- **FR-21:** Tests must cover grant/deny/revoke scope; every execution mode;
  model and tool approval denial/timeout/cancellation; navigation and bridge
  disconnect; context-root and redaction behavior; audit persistence/private
  session/deletion; and no provider credential or raw transport leakage.
- **FR-22:** The built extension manifest must never use `<all_urls>` or broad
  required/active host access. Exact official provider origins may be required.
  A browser may declare broad HTTPS _optional eligibility_ only when the user
  must perform a browser-mediated gesture to activate one exact custom endpoint
  origin, which remains inspectable and revocable. Tests distinguish required,
  optionally eligible, and actively granted origins.
- **FR-23:** The project must provide a runnable sample application containing
  read, write, destructive, named-context-region, and form-context examples.
