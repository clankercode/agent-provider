# Implementation status

Agent Provider is a release candidate for bounded, user-owned deployments. This
status records what the running code enforces, separately from the complete
design contract in `project_docs/`. It is not yet a signed or published store
release and should not be described as generally production-ready.

## Implemented and verified

- Dual CC0-1.0 OR Unlicense licensing, promoted-source provenance, monorepo
  package metadata, CI, and development documentation.
- Version-negotiated page/content/background bridge with correlated sessions,
  bounded wire values, cancellation, safe errors, and a regression test for
  reflected `window.postMessage` bootstrap traffic.
- Headless runtime, typed read/write/destructive tools, page-native mutation
  approval, immutable context snapshots/regions/diffs/redaction, React UI, and
  optional WebMCP exposure.
- Chrome and Firefox extension-owned exact-origin consent,
  session/persistent revocation,
  provider profiles and aliases, alias authority fingerprints, extension-only
  credentials, canonical endpoint checks, manual redirects, request bounds,
  timeouts, concurrency limits, result scrubbing, and extension-owned popup,
  approval, and settings surfaces.
- OpenAI-compatible, Anthropic-compatible, and Gemini adapter seams. Fixture
  tests cover all three. Settings include family-specific endpoint presets and
  bounded, paginated, on-demand model discovery with manual-ID fallback.
  Authorized live catalog discovery and generation cover OpenAI-compatible and
  Anthropic-compatible gateways with `MiniMax-M2.7-highspeed` without
  persisting credentials.
- Durable per-origin request, token, and cost reservations in IndexedDB,
  conservative unknown-outcome settlement across MV3 worker restarts, and
  concurrency bounds.
- Standard, audit-first, and private execution modes. Provider and tool steps
  use extension-owned approvals in audit-first mode; tool execution reports are
  bound to a single approved declaration/input and state transition.
- Metadata-only session audit, opt-in bounded persistent audit, private-mode
  exclusion, per-origin/global inspection and deletion, and independent grant
  revocation.
- Actual unpacked Chrome bootstrap/session-open browser smoke, exact localhost
  origin rejection, live provider generation, and visual QA for dashboard,
  popup, approval, and settings in desktop/mobile light/dark modes.
- The settings save bar appears only for dirty, saving, saved, or failed state;
  it clears its saved receipt automatically and uses visible enter/exit motion
  with a reduced-motion path.
- Clean Chrome MV3 and Firefox MV3 production builds. Firefox runs an actual
  extension bootstrap smoke in system Firefox in addition to `web-ext lint`.
- Packed npm consumer tests install all six public packages from tarballs and
  exercise runtime and declaration imports.
- Reproducible Chrome, Firefox, and Firefox-review source archives with SHA-256
  checksums from a clean commit.

## External release gates

- Choose a public support contact and stable HTTPS privacy-policy URL, then
  complete publisher identity and store data-use declarations.
- Enroll the publisher accounts, sign, submit, and review the browser artifacts.
- Confirm npm scope ownership and publish the six public packages. The names are
  currently unclaimed or inaccessible from the public registry, but publication
  credentials were not supplied.

## Deliberately deferred verification and scope

- The integrated browser suite does not yet automate every FR-21 branch:
  approval denial/timeout/cancellation, navigation during a request, forced
  service-worker restart, and custom-host permission gestures remain covered by
  unit/component seams or manual behavior rather than full browser scenarios.
- Firefox verifies a real MV3 bridge session, build, and lint, but live provider
  and full control-surface parity remain Chrome-led.
- Gemini is fixture-tested only; an authorized live Gemini fixture is deferred.
- Managed policy/export/synchronization remain extension seams, not v1
  features. User-owned local policy is the selected bounded-deployment model.
- Safari is unsupported and is not a release gate.

## Verification commands

```bash
npm run check
npm run test:browser
npm run test:browser:live
npm run test:firefox
npm run package:stores
```

The live test reads the explicitly authorized local credential files at runtime,
tries the backup only after a 401/403 response, and never prints or stores the
credential.
