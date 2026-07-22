# Implementation status

Agent Provider is an active alpha. This status records what the running code
enforces, separately from the complete design contract in `project_docs/`.

## Implemented and verified

- Dual CC0-1.0 OR Unlicense licensing, promoted-source provenance, monorepo
  package metadata, CI, and development documentation.
- Version-negotiated page/content/background bridge with correlated sessions,
  bounded wire values, cancellation, safe errors, and a regression test for
  reflected `window.postMessage` bootstrap traffic.
- Headless runtime, typed read/write/destructive tools, page-native mutation
  approval, immutable context snapshots/regions/diffs/redaction, React UI, and
  optional WebMCP exposure.
- Chrome extension-owned origin consent, session/persistent revocation,
  provider profiles and aliases, alias authority fingerprints, extension-only
  credentials, canonical endpoint checks, manual redirects, request bounds,
  timeouts, concurrency limits, result scrubbing, and extension-owned popup,
  approval, and settings surfaces.
- OpenAI-compatible, Anthropic-compatible, and Gemini adapter seams. Fixture
  tests cover all three. Authorized live generation covers OpenAI-compatible
  and Anthropic-compatible gateways without persisting credentials.
- Actual unpacked Chrome bootstrap/session-open browser smoke and visual QA for
  dashboard, popup, approval, and settings in desktop/mobile light/dark modes.
- Clean Chrome MV3 and Firefox MV2 production builds. Firefox has build parity,
  not automated runtime parity.

## Explicit production blockers

The modules for grant-policy resolution, reserve/settle quotas, metadata-only
audit retention/deletion, and single-use approval records are implemented and
unit-tested, but they are not yet wired into the background provider/tool
lifecycle or surfaced as complete controls. Consequently this alpha does not
yet provide:

- durable per-origin request/token/cost budgets across worker restarts;
- audit-first approval of every provider request and every tool call;
- private-session behavior and opt-in persistent audit controls;
- origin/global audit inspection and deletion UI;
- extension-side tool execution reports and single-use extension approval
  consumption;
- the full restart/navigation/disconnect/outcome-unknown integration matrix.

Do not describe this repository as production-ready until these are enforced
end to end and security-reviewed.

## Verification commands

```bash
npm run check
npm run test:live
xvfb-run -a node design/capture-ui.mjs
```

The live test reads the explicitly authorized local credential files at runtime,
tries the backup only after a 401/403 response, and never prints or stores the
credential.
