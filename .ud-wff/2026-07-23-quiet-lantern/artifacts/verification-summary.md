# Verification output

- `npm run check`: PASS (format, typecheck, 77 ordinary tests, package builds,
  Chrome MV3 build, Firefox MV2 build, example build).
- `npm run test:live`: PASS (OpenAI-compatible and Anthropic-compatible
  generation; primary credential fallback only after authentication failure).
- `xvfb-run -a node design/capture-ui.mjs`: PASS (actual unpacked Chrome bridge
  and visual captures).
- `npm audit --omit=dev`: PASS (zero known production vulnerabilities).
- Manifest inspection: PASS (`<all_urls>` absent; application matches limited
  to configured loopback development origins).
- `git diff --check`: PASS.

Firefox runtime automation, Gemini live testing, Safari, store signing, and P0
production lifecycle controls are explicitly deferred and do not form part of
the accurately scoped alpha claim.
