# Tool call failures on LAN HTTP dogfood

**Status:** Agent Provider defect (page-side SDK), not control-server tool handlers  
**Date:** 2026-07-30  
**Observed on:** Playwright profile `agent-provider-dogfood`, page `http://10.42.0.8:15066/`  
**Symptom:** After connect/grant succeeds, **every** page tool execution fails with:

```text
TypeError: Cannot read properties of undefined (reading 'digest')
```

Model chat without tool execution can still work (tool *catalog* listing from the model is fine). Tool *runs* die before the host `execute()` body runs.

---

## Verdict

| Layer | Responsible? | Notes |
| --- | --- | --- |
| control-server WebMCP handlers | **No** | Failure happens before host tool `execute` |
| control-server CONTROL_TOKEN | **No** | Same error on unauthenticated tools (`get_control_plane_status`, `auth_status`) |
| Agent Provider page runtime / protocol | **Yes** | `sha256Canonical` requires `crypto.subtle.digest` |
| Agent Provider extension SW | Not the first failure | Extension pages are secure contexts; page is not |

This is **Agent Provider**. control-server should not try to polyfill Web Crypto to paper over it long-term (though HTTPS dogfood would mask it).

---

## Reproduction (Playwright / dogfood)

1. Named profile + CDP (see `docs/PLAYWRIGHT-DOGFOOD.md`):
   - Profile: `~/.cache/agent-provider/playwright-profiles/agent-provider-dogfood`
   - CDP: `http://127.0.0.1:9333`
2. Open control-plane: `http://10.42.0.8:15066/` (or `:15066` on `10.100.1.2`).
3. Ensure AP extension loaded, origin allowed, dock connected, `maxTools` ≥ page tool count (~46).
4. In copilot chat, ask the agent to call any tool, e.g. `get_control_plane_status` or `auth_status`.
5. Every tool result is the same `digest` TypeError.

Live page probe (Playwright `page.evaluate`):

```json
{
  "origin": "http://10.42.0.8:15066",
  "isSecureContext": false,
  "hasSubtle": false,
  "protocol": "http:",
  "digestOk": false,
  "digestError": "no subtle"
}
```

Chrome only exposes `crypto.subtle` in [secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) (HTTPS, `localhost` / `127.0.0.1`, etc.). Private-LAN cleartext HTTP is **not** a secure context → `globalThis.crypto.subtle === undefined`.

Artifacts from lifecycle dogfood: `/tmp/ap-lifecycle-run2/` (full transcript shows 100% tool failure with identical error).

---

## Failure chain

```
@agent-provider/runtime createToolSet execute
  → sha256Canonical(declaration)   // packages/protocol
  → sha256Canonical(input)
  → extensionAuthority.requestApproval({ declarationHash, inputHash, ... })
  → host definition.execute(...)   // never reached on this bug
```

Page-side hashing is mandatory for tool approval binding (`declarationHash` / `inputHash`) even for `risk: "read"` tools when an extension authority is attached.

### What ships to integrators today

`control-server` depends on npm `@agent-provider/*` (`^0.1.1` range; installed protocol **0.1.3**). Bundled page code still contains the **unconditional** path:

```js
// from node_modules/@agent-provider/protocol/dist/index.js (0.1.3)
async function sha256Canonical(value) {
  const bytes = new TextEncoder().encode(canonicalize(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  // ...
}
```

Same shape is inlined in the control-server production web bundle (`web/dist/assets/index-*.js`).

So on `http://10.42.0.8:15066`:

```text
globalThis.crypto.subtle → undefined
undefined.digest(...)    → TypeError: Cannot read properties of undefined (reading 'digest')
```

### Source tree vs published

In this monorepo, `packages/protocol/src/canonical.ts` **already has** a `crypto.subtle` guard + `fallbackHash`. That fix is **not** what control-server (or the dogfood page) is running.

Problems with the in-tree fallback as written (must fix before relying on it):

1. **Not released / not consumed** by CS npm deps or dogfood bundle.
2. **Hash length:** `fallbackHash` returns **32** hex chars (4× uint32). Extension validators expect **64** hex chars (`isHash` / `/^[a-f0-9]{64}$/` on `declarationHash` / `inputHash` in `apps/extension/entrypoints/background.ts` and tests). A short fallback would pass the page crash and then fail approval validation in the service worker.
3. **Security wording:** comments call the digest “display only”; it is also used as the approval binding fingerprint. Prefer a real SHA-256 pure-JS implementation (or refuse with a clear error) rather than FNV-1a.
4. **Extension path is fine for SW:** `apps/extension/lib/canonical-json.ts` still uses bare `crypto.subtle` — OK for extension documents (secure context). Page protocol is the broken surface.
5. **Tests** (`packages/protocol/src/bootstrap.test.ts`) only assert `/^[a-f0-9]{64}$/` under Node (where subtle exists). No test forces `crypto.subtle = undefined` to lock the non-secure path.

---

## What is *not* broken

- Extension inject / bootstrap / grant on dogfood hosts (after host-match + maxTools fixes).
- Model generate/stream over the bridge (no page-side subtle required for the model path itself).
- control-server WebMCP tool implementations (API + token). They never run when hashing throws first.
- “46 tools > maxTools 32” — separate profile/settings issue; raise `limits.maxTools` (or ship a higher default). Unrelated to `digest`.

---

## Recommended fix (Agent Provider)

### P0 — page `sha256Canonical` without subtle

In `@agent-provider/protocol` (and anything that reimplements it):

1. If `globalThis.crypto?.subtle?.digest` is missing or throws, use a **pure SHA-256** that still returns **64 lowercase hex chars** (same as Web Crypto).
2. Add a unit test that temporarily stubs `globalThis.crypto = { subtle: undefined }` (or deletes subtle) and asserts:
   - no throw
   - result matches `/^[a-f0-9]{64}$/`
   - stable across two calls with the same input
   - preferably matches Web Crypto when both are available (golden vector)
3. Publish new protocol (+ runtime/react that depend on it) and cut a release CS can consume.

Optional product choice if pure SHA-256 is undesirable in-page:

- Fail fast with an explicit bridge/runtime error:  
  `SECURE_CONTEXT_REQUIRED: tool approval hashing needs crypto.subtle (use HTTPS or localhost)`.  
  Still better than a raw TypeError — but LAN HTTP dogfood will remain unusable for tools until HTTPS or the pure hash lands.

### P1 — docs

- `docs/INTEGRATING.md` / `docs/PLAYWRIGHT-DOGFOOD.md`: document that **tool execution on non-secure HTTP origins** requires the subtle fallback (or HTTPS).
- Note private IP HTTP ≠ secure context (unlike `http://127.0.0.1`).

### P1 — release / consumer lag

- Until a release ships, dogfood CS will keep failing even if monorepo source is fixed.
- Temporary CS workaround (not preferred): pin to a local/file build of protocol/runtime **or** serve dogfood over HTTPS. Do not brand or special-case Amaroo inside AP.

### P2 — extension `canonical-json.ts`

- Keep using subtle in extension contexts, or share the same pure SHA-256 helper for consistency. Not required for this bug.

---

## Verification checklist (after fix)

On `http://10.42.0.8:15066` with AP extension granted:

1. `isSecureContext === false` and `crypto.subtle == null` still true (proves we did not “fix” by moving to HTTPS only).
2. Chat → call `auth_status` and `get_control_plane_status` → both return structured results (not TypeError).
3. Call a confirm-gated mutation tool → approval UI still works; hashes accepted by SW (`isHash` 64 hex).
4. Protocol unit tests pass with subtle stubbed out.
5. control-server rebuilt against the new package versions; dogfood `/health` on new CS build if package bump required there.

---

## Quick references

| Item | Path / value |
| --- | --- |
| Page hasher (source, has partial fallback) | `packages/protocol/src/canonical.ts` → `sha256Canonical` |
| Page tool wrapper | `packages/runtime/src/tools.ts` → `createToolSet` |
| Extension hash check | `apps/extension/entrypoints/background.ts` → `isHash` |
| Extension hasher (subtle-only) | `apps/extension/lib/canonical-json.ts` |
| Published protocol (broken on LAN HTTP) | `node_modules/@agent-provider/protocol@0.1.3` `sha256Canonical` |
| Integrator dogfood page | `http://10.42.0.8:15066/` / `http://10.100.1.2:15066/` |
| Playwright notes | `docs/PLAYWRIGHT-DOGFOOD.md` |

---

## One-line summary

**All tool calls fail on LAN cleartext HTTP because the published page SDK hashes tool approval payloads with `crypto.subtle.digest`, which does not exist outside secure contexts; control-server tools are never invoked.**
