# Agent Provider alpha implementation report

## Summary

The cross-browser Agent Provider alpha is implemented, committed, and verified.
Chrome is the required target; Firefox builds cleanly. Production-only controls
that were deliberately deferred are named as P0 blockers and are not included
in the readiness claim.

## Scope completed

- Foundation: `artifacts/foundation-output.json`
- Core packages: `artifacts/core-output.json`
- Extension alpha authority and provider seams: `artifacts/extension-output.json`
- Consumer and UI surfaces: `artifacts/consumers-output.json`
- Verification evidence: `artifacts/verification-output.json`

Every included output has a PASS review with attempted decisive criticisms.

## Excluded or terminal non-included work

Durable quotas, audit-first/private execution, persistent audit controls,
per-step extension approval wiring, Firefox runtime automation, Gemini live
testing, Safari, store publication, and signing are deferred. Their acceptance
requirements and reasons are durable in `docs/FUTURE-CONCERNS.md`.

## Verification evidence

- `npm run check` exited 0.
- `npm run test:live` exited 0.
- `xvfb-run -a node design/capture-ui.mjs` exited 0.
- `npm audit --omit=dev` exited 0 with zero known production vulnerabilities.
- Chrome and Firefox manifest inspection found no `<all_urls>`.

## Open questions and blockers

No question blocks the alpha implementation. The deferred P0 items block only a
future production-ready claim and do not require a user decision now.

## How this could be wrong

Firefox could expose runtime-specific extension differences despite its clean
build. Worker restart/navigation behavior could reveal lifecycle defects not
covered by the Chrome session smoke. The provider gateway could drift after the
live test. These uncertainties are bounded by the explicit parity and P0 queue.

## Remote effects and publish gate

No remote publish, push, store submission, or irreversible external operation
was performed.
