# Testing and release

## Validators

- Unit/property: codec, envelopes, IDs, version negotiation, scrubbing,
  schemas, approvals, policy precedence, quota reservation/settlement, audit
  retention/deletion, context extraction/redaction/diffs/truncation, and
  provider fixture normalization.
- Integration: page/content/background transport, consent, page/extension
  approvals, streams, cancellation, timeout, worker restart, navigation,
  disconnection, and uncertain-request no-replay behavior.
- Browser E2E: Chrome is required and Firefox is the parity target in CI.
  Safari build/conversion on macOS CI is best-effort and is not a v1 blocker.
- Security: no credentials, headers, raw provider bodies/chunks, redacted
  context, or private audit data reaches page messages or persistent logs.
- Consumer: packed headless, React, vanilla, advanced AI SDK, and optional
  WebMCP imports compile and execute in the sample.
- Provenance: package SPDX metadata, owner relicensing record, promoted-source
  inventory, dependency licenses, and third-party notices remain consistent.

## Default limits under test

- Context: 32 KiB frame, depth 32, 128 regions, 4 KiB per form value.
- Runtime: two concurrent runs per origin, 32 tools, 120-second provider
  timeout, and 8,192 requested output tokens.
- Starter origin policy: 10 requests/minute, 200/day, and one million
  tokens/day. A US$5/day cap applies only with trustworthy price metadata;
  unknown custom pricing needs an explicit waiver.
- Persistent audit: off by default; when enabled, 30 days, 10,000 events, or
  10 MiB globally.

## Browser permission acceptance

Built manifests are inspected separately for required, optionally eligible,
and actively granted hosts. No build may request `<all_urls>` or broad required
host access. Chromium and Firefox custom endpoints use broad HTTPS optional
eligibility followed by an exact-origin user-gesture grant. Safari must pass an
equivalent release test or expose the documented exact-build-host fallback.
Application-page tests separately assert exact build-time
`content_scripts.matches`, sender-origin derivation, deployment allowlisting,
and the independent user grant.

Adversarial endpoint tests reject non-loopback HTTP, credentials in URLs,
queries/fragments, malformed ports, lookalike hosts, redirects, and any attempt
to attach credentials to a destination other than the configured exact origin.
Cancellation tests distinguish provider and callback states before and after
dispatch and require uncertain outcomes to remain unreplayed.

Protocol tests include asymmetric bootstrap ranges, downgrade, malformed range,
no overlap, forged approval results, duplicate decisions, expiration,
navigation, cross-session replay, and execution-report correlation.

## Release gate

Completion requires all workspace tests, type checks, builds, package-consumer
tests, browser manifest assertions, and workflow reviews to pass. CI also emits
unpacked browser artifacts, hashes, an SBOM, provider fixture evidence, and
installation/revocation/incident instructions. Live provider smoke tests are
opt-in because they require user credentials. Store submission, signing, and
notarization are reconciled release operations and are not silently performed
by local implementation automation.

The authorized local smoke-test configuration reads its API key at runtime from
`~/.llmp-key-test-1`, uses `https://***REMOVED***/` for the
Anthropic-compatible adapter, and uses
`https://***REMOVED***/v1` for the OpenAI-compatible adapter. The
key must never appear in commands, logs, repository files, workflow events, or
test artifacts. Gemini remains fixture-tested until a separately authorized
endpoint is configured.

If the primary key is rejected for authentication, the runner retries once with
`~/.llmp-key-test-1.bak.20260722152638`. It reports only which key source
succeeded and never reports key material.

## Explicit release stubs

- Safari remains behind a macOS build/smoke validator. Until it passes, any
  Safari build exposes only exact build-time provider origins and explains that
  limitation in settings; Safari may be deferred entirely without blocking v1.
- Browser-store submission, signing, and notarization require operator accounts
  and external approvals. The repository prepares artifacts and checklists but
  cannot claim those remote effects occurred until reconciled evidence exists.
