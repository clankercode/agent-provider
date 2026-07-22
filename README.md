# Agent Provider

Agent Provider lets a trusted web application run a typed, tool-using AI agent
without owning the user's model credentials. The application supplies context
and callbacks; a browser extension supplies exact-origin, policy-constrained
access to a user-configured model provider.

This repository is a release candidate for bounded, user-owned deployments.
Chrome is the required browser, Firefox has build and runtime-smoke parity, and
Safari is not currently supported. It is not yet a signed store release. See
[implementation status](docs/IMPLEMENTATION-STATUS.md) before deployment.

## Workspace

- `@agent-provider/runtime` — headless runtime, tools, approvals, and observable
  run state.
- `@agent-provider/context` — bounded revisioned page-context extraction.
- `@agent-provider/ai-sdk` — advanced AI SDK `LanguageModel` bridge.
- `@agent-provider/react` — React bindings and reference UI.
- `@agent-provider/webmcp` — optional explicit WebMCP adapter.
- `apps/extension` — credentials, exact-origin grants, provider brokering,
  policy/audit primitives, and browser control surfaces.
- `examples/operations-dashboard` — runnable trusted-app example.

## Development

Requirements: Node.js 22 or newer and npm.

```bash
npm install
npm test
npm run typecheck
npm run build
```

Use `npm run dev:extension` and `npm run dev:example` in separate terminals.
The development build is limited to the exact application matches in
`apps/extension/agent-provider.config.ts`.

Provider credentials are configured in the extension, never in page code.
Expected provider, policy, permission, cancellation, and bridge failures are
returned as structured outcomes.

The current implementation enforces exact-origin consent, alias authority
fingerprints, durable per-origin quotas, audit-first/private execution,
single-use extension approval, provider destination checks, result scrubbing,
and bounded metadata-only audit controls. Remaining release gates are recorded
explicitly rather than implied by the implementation.

## Security model

An exact origin is one trust principal. Agent Provider protects extension-held
provider credentials from ordinary page JavaScript; it does not sandbox a
malicious script already running on a granted origin. Every page tool must keep
ordinary server-side authorization, validation, idempotency, and business
limits. See [the threat model](docs/THREAT-MODEL.md).

The design contract is in [`project_docs/`](project_docs/) and the accepted
implementation plan is in
[`.plan/2026-07-23-quiet-lantern/`](.plan/2026-07-23-quiet-lantern/).

## License

Original and owner-authorized promoted code is available under your choice of
CC0 1.0 Universal or the Unlicense. See [LICENSE](LICENSE) and
[PROMOTED-SOURCES.md](PROMOTED-SOURCES.md). Third-party dependencies retain
their own terms.
