# Agent Provider implementation plan

Status: accepted and in progress on 2026-07-23.

## Goal

Deliver a browser-mediated agent runtime for trusted first-party applications.
The page owns instructions, context, typed tools, and callbacks. The extension
owns provider credentials, exact-origin grants, provider networking, policy,
authoritative provider consent, and metadata-only audit.

## Delivery sequence

1. Establish the canonical workspace, dual licensing, architecture, protocol,
   threat model, and CI foundation. Selectively promote the reviewed Sitehand
   bridge, codec, cancellation, scrubbing, and AI SDK work without retaining
   its public names or compatibility surface.
2. Deliver a tracer bullet with one OpenAI-compatible profile, exact-origin
   session consent, streaming, cancellation, one read tool, an optional initial
   context frame, and headless/React/vanilla consumers.
3. Complete required tool risk/schema handling, write/destructive approvals,
   live revisioned context, regions, forms, redaction, diffs, and lazy tools.
4. Complete extension policy, audit-first/private modes, provider profiles,
   aliases, grants, quotas, metadata-only audit, revocation, and deletion.
5. Add Anthropic-compatible and Gemini adapters, Firefox and Safari builds,
   lifecycle hardening, the optional WebMCP adapter, and release packaging.
6. Run the full unit/integration/browser/security/consumer test matrix and an
   independent decisive-criticism review before reporting completion.

## Binding decisions

- Product and package name: Agent Provider and `@agent-provider/*`.
- Runtime: small Agent Provider API plus an advanced AI SDK `LanguageModel`
  export. The page/extension wire uses Agent Provider serializable types.
- Providers: OpenAI-compatible, Anthropic-compatible, and Gemini; configurable
  endpoint and API key, no OAuth in v1.
- Browsers: Chrome is the required v1 target and Firefox is the parity target.
  Safari on macOS is best-effort and may be deferred or dropped if its APIs or
  signing path threaten Chrome/Firefox delivery. Unpacked builds are the
  immediate artifact; signed distribution is a later release operation.
- Context: optional, immutable revisioned Markdown-oriented frames. When a
  context source is configured, the initial mode defaults to `snapshot`, with
  `none` and `manifest` alternatives and lazy full/region/diff tools.
- Modes: `standard | audit-first` plus orthogonal `private`.
- Policy: user-owned bounded small-team v1. The merge seam is ready for a
  future `storage.managed` adapter that may only tighten policy.
- Permissions: exact official provider hosts; broad HTTPS eligibility may be
  declared only as optional permission so Chromium/Firefox can grant one exact
  custom endpoint. Safari falls back to build-time exact origins if parity is
  unavailable.
- WebMCP: separate, explicit, off-by-default adapter using the same executor and
  approval path.
- License: original and promoted code is available under
  `CC0-1.0 OR Unlicense`; third-party code retains its own terms.

## Supporting specifications

- [Architecture](architecture.md)
- [Wire protocol](protocol.md)
- [Testing and release](testing-and-release.md)
- [Provenance and relicensing](provenance.md)
- Canonical product requirements remain in [`project_docs/`](../../project_docs/).
