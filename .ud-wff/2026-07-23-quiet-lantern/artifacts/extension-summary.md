# Extension output

Implemented Chrome/Firefox extension builds, exact-origin content/background
bridge, extension-owned consent, session and persistent revocation, provider
profiles and aliases, authority fingerprints, credentialed destination-checked
fetch, request policy, timeout/concurrency bounds, result scrubbing, and
OpenAI/Anthropic/Gemini adapter seams. Grant, policy resolution, quotas, audit,
and single-use approval primitives are unit-tested.

The alpha lifecycle boundary is explicit: durable quotas, audit-first/private
mode, persistent audit UI, and per-step extension approvals are not yet wired.
They are P0 production blockers in `docs/FUTURE-CONCERNS.md`.

Evidence: 50 extension unit tests and two authorized live provider tests pass;
Chrome MV3 and Firefox MV2 builds are clean; manifests contain no `<all_urls>`.
