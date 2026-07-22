# Agent Provider security review 1

Date: 2026-07-23  
Scope: browser extension, page bridge, public packages, sample application,
store packaging, and dependency/update chain  
Method: single-agent, attack-led source review plus unit, package-consumer, and
real-browser verification

## Executive result

**PASS WITH RELEASE GATES.** No unresolved critical, high, or medium security
finding remains in the reviewed code. The review found three authority or
availability weaknesses and fixed all three before this report:

1. a static localhost match could connect an unlisted port to the background
   bridge;
2. page-supplied tool execution reports were insufficiently bound to an
   approved state transition; and
3. one tab could create an unbounded number of bridge client sessions.

Residual risks are explicit below. The most important are incomplete
browser-level lifecycle coverage and non-durable tool-report correlation across
a service-worker restart. These do not expose provider credentials or bypass
the independent application callback authorization boundary, but they should be
closed before a broad production claim.

## Security invariants reviewed

- The page and content script are untrusted; the extension background owns
  credentials, endpoint selection, grants, policy, quota state, and audit.
- Runtime sender origin, configured deployment coverage, and user grant are all
  required and rechecked for model dispatch.
- Provider destinations are canonical and exact; redirects fail closed before
  credentials can be forwarded elsewhere.
- Page-controlled provider options, headers, URLs, and provider-executed tools
  are rejected or stripped.
- Write/destructive callbacks require page-native approval; audit-first adds a
  single-use extension approval bound to declaration and input.
- Page-visible results exclude raw HTTP bodies, headers, chunks, and
  credential-like metadata.
- Persistent quota accounting reserves before dispatch and treats abandoned
  work conservatively rather than replaying it.
- Private mode never writes persistent audit content; default audit is
  metadata-only.

## Attack-surface table

| Surface               | Attacker-controlled input                              | Authority at risk                             | Control and evidence                                                                                                                                                                            | Result                           |
| --------------------- | ------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Page/content bridge   | origin, bootstrap, identifiers, requests, cancellation | session creation and model access             | exact `originBridgeEnabled` recheck, protocol guards, session correlation, per-tab client cap (`apps/extension/entrypoints/background.ts:140`, `:694`, `:1277`)                                 | Pass after SEC-001/003           |
| Model dispatch        | prompt, aliases, public model options                  | credential use, quota spend                   | per-request grant/fingerprint check, policy sanitizer, reserve-before-dispatch, endpoint validation (`background.ts:794-930`)                                                                   | Pass                             |
| Provider network      | endpoint/profile configuration, provider response      | credential exfiltration and result leakage    | exact URL construction, credential attachment after destination check, manual redirect rejection, output scrubber (`apps/extension/lib/provider-endpoint.ts:114-195`, `result-policy.ts:1-131`) | Pass                             |
| Tool callback         | declaration, schema, arguments, execution reports      | application mutation and audit integrity      | schema validation, page-native mutation approval, extension declaration/input binding, approved-to-dispatched-to-terminal state (`packages/runtime/src/tools.ts`, `background.ts:1070-1255`)    | Pass after SEC-002               |
| Extension UI messages | tab/origin/settings/deletion requests                  | grants, audit, provider configuration         | extension-page sender restriction, structured message guards, destructive confirmation in UI (`background.ts:1500-1687`, `apps/extension/lib/ui-messages.ts`)                                   | Pass                             |
| Local persistence     | credentials, grants, approvals, audit, quotas          | confidentiality, replay, accounting           | extension-only storage, single-use IndexedDB approvals, bounded audit, serialized persistent quotas (`apps/extension/lib/approvals.ts`, `audit.ts`, `persistent-quotas.ts`)                     | Pass with restart caveat         |
| Build/update chain    | npm dependencies and archive contents                  | supply-chain substitution or secret inclusion | lockfile, package tarball consumer smoke, clean-commit store packager, path exclusions, SHA-256 output                                                                                          | Pass; publisher signing external |

## Findings

### SEC-001 — Static localhost match admitted an unlisted port

- Severity before fix: **Medium**
- Status: **Fixed and browser-regressed**
- Attack: the manifest's localhost match pattern cannot express a port. A page
  on another localhost port could therefore load the content script and, after
  the earlier background trust check was removed, negotiate a bridge session.
- Impact: the origin still lacked an exact user grant, so this was not a direct
  credential disclosure. It weakened deployment allowlisting and could present
  consent for an origin the build did not intend to support.
- Fix: background connection bootstrap now awaits `originBridgeEnabled(origin)`
  and disconnects before creating session state when the exact origin is not
  configured or browser-authorized (`background.ts:694-707`, `:1260-1306`).
- Regression: the Chrome integration test serves an untrusted fixture on port
  5174 and proves it cannot receive bridge readiness
  (`scripts/test-extension-browser.mjs:140-153`, `:210-247`).

### SEC-002 — Tool execution reports lacked a strict authorization transition

- Severity before fix: **Medium**
- Status: **Fixed**
- Attack: a granted page could submit forged or out-of-order tool report states,
  especially in standard mode, and pollute extension audit metadata.
- Impact: this did not execute a callback or bypass page-native mutation
  approval, but it weakened audit integrity.
- Fix: every approved tool proposal now creates a declaration/input-bound
  authorization; reports must transition once from `approved` to `dispatched`
  before a terminal state, and mismatches become policy failures
  (`background.ts:1137-1168`, `:1191-1255`).

### SEC-003 — Unbounded bridge clients per tab

- Severity before fix: **Low**
- Status: **Fixed**
- Attack: page JavaScript could emit unique bootstrap client IDs until the
  extension worker accumulated session entries.
- Impact: tab-local extension-worker memory pressure and availability loss.
- Fix: each tab-origin port now accepts at most 32 distinct clients and rejects
  excess bootstrap requests (`background.ts:122`, `:1275-1290`).

## False leads and controls that held

- Redirect-based credential theft failed because provider fetches use manual
  redirects and reject all redirect responses.
- Provider endpoint path escape failed under WHATWG normalization and exact
  base-path checks.
- Page-supplied provider headers/options/tools did not cross the policy
  sanitizer.
- Approval replay failed because persistent approval consumption is atomic and
  hash-bound.
- Raw provider error/header/body/chunk material did not survive the result
  policy tests.
- Private audit writes were skipped even when persistent audit was enabled.
- Abandoned quota reservations were settled conservatively after manager
  reconstruction instead of released for replay.

## Verification evidence

- `npm audit --omit=dev --audit-level=moderate`: zero vulnerabilities.
- `npm audit --audit-level=high`: zero vulnerabilities in the full tree.
- `npm run typecheck`: pass.
- `npm test`: 24 test files, 82 tests, all pass; two workspaces intentionally have
  no runtime tests.
- `npm run build`: all six packages, Chrome MV3, Firefox MV3, and sample app
  build.
- `node scripts/test-extension-browser.mjs`: real Chromium extension pass,
  including exact-port rejection.
- Live Chromium extension request: pass against the authorized Anthropic gateway
  using the backup credential only after the primary returned 401/403.
- Firefox MV3: real system-Firefox bridge smoke passes; `web-ext lint` has zero
  errors and three documented dependency-originated warnings.
- Packed package consumer smoke: all six tarballs install and runtime/type
  consumers pass.

## Residual risks and release gates

- The tool execution-report map is memory-only. A service-worker restart during
  a callback can produce an unknown audit outcome; it cannot authorize a new
  callback. Persist it if exact post-restart tool reconciliation is required.
- The browser suite does not yet force every denial, timeout, cancellation,
  navigation, disconnect, service-worker restart, or custom-host permission
  gesture required by the full FR-21 matrix.
- A granted origin includes every script running at that origin. Application
  CSP, dependency hygiene, server authorization, idempotency, and business
  limits remain mandatory.
- Extension-local storage is not an operating-system credential vault.
- Store publisher identity, privacy URL/contact, declarations, signing, and
  review are external and incomplete.

## Independent review log

Independent reviewer: **NOT RUN**. The user requested fewer subagents, so this
review remained single-agent. A separate review is recommended before broad
distribution or after any material protocol, permission, provider, or manifest
change.
