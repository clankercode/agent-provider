# Future concerns and explicit stubs

This is the durable queue for work intentionally deferred from the release
candidate. The order reflects safety and delivery impact.

## P0: required before a production claim

1. Publish the privacy policy with a real support contact, finish Chrome Web
   Store and AMO declarations, and complete publisher signing/submission.
2. Add integrated browser scenarios for model/tool approval denial, timeout,
   and cancellation; navigation and bridge disconnect during dispatch; forced
   service-worker restart; and unknown-outcome no-replay reconciliation. The
   underlying seams are tested, but FR-21 asks for the complete integrated
   matrix.
3. Persist in-flight tool execution authorization if browser-worker restart
   reconciliation must distinguish an eventually completed callback from an
   unknown result. Current model quota reservations survive restart; the
   short-lived tool-report correlation map does not.
4. Automate popup-driven exact custom HTTPS host activation/revocation. Browser
   APIs require a user gesture, so the current release documents and implements
   the flow but tests the allowlist/permission seams below full browser level.
5. Complete an independent security review after any material protocol,
   provider, permission, or store-manifest change. The current review was
   attack-led but intentionally single-agent.

## P1: release and parity work

- Extend Firefox automation from a real MV3 bridge smoke to the Chrome suite's
  provider, grant, audit, and control-surface coverage.
- Confirm npm scope ownership, publish all six package tarballs, and repeat the
  packed-consumer smoke against the registry artifacts.
- Add a separately authorized Gemini live smoke; current Gemini verification is
  fixture-only.
- Add managed policy as a tightening-only layer when a deployment needs it.
- Add automated accessibility checks and a second-browser visual regression
  pass for the extension control surfaces.

## Deliberately unsupported

Safari is not a v1 blocker and is currently unsupported. Chrome is required;
Firefox is the next parity target.
