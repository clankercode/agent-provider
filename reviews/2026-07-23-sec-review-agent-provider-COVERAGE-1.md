# Agent Provider security review coverage 1

Date: 2026-07-23  
Companion report: `2026-07-23-sec-review-agent-provider-1.md`

## Reviewed source and configuration

| Area                      | Files/surfaces                                                                                                                                       | Coverage                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Protocol and page bridge  | `packages/protocol/src/`, `packages/ai-sdk/src/transport.ts`, `packages/ai-sdk/src/bridge.ts`, content script, background bootstrap/session handling | Source and tests reviewed; Chromium/Firefox bootstrap exercised                                                      |
| Runtime and tools         | `packages/runtime/src/runtime.ts`, `tools.ts`, `approval.ts`, runtime tests                                                                          | Source, schema/approval flow, report path, cancellation semantics reviewed                                           |
| Context                   | `packages/context/src/page-context.ts` and tests                                                                                                     | Root resolution, forms, redaction precedence, limits, immutable revisions reviewed                                   |
| Extension authority       | `apps/extension/entrypoints/background.ts`, grants, policy, settings, UI messages                                                                    | Source reviewed across grant, model, tool, audit, quota, disconnect, and UI handlers                                 |
| Provider network          | provider endpoint/profile/adapter/result-policy modules and tests                                                                                    | Destination, credential attachment, redirect, abort, provider normalization, result scrubbing reviewed               |
| Persistence               | grants/settings storage, approvals, audit, persistent quotas                                                                                         | Source and unit tests reviewed; restart model examined                                                               |
| Control surfaces          | popup, approval, options apps and CSS                                                                                                                | Permission/mode/audit/provider controls and destructive confirmation reviewed; visual artifacts previously inspected |
| Manifests and permissions | WXT config, built Chrome/Firefox manifests, `store/PERMISSIONS.md`                                                                                   | Required, optional-eligible, configured, and active-origin model reviewed                                            |
| Packages                  | six package manifests, exports, tarball test script                                                                                                  | Pack/install/runtime/type consumer behavior reviewed                                                                 |
| Release chain             | root scripts, lockfile, CI workflow, store packager/docs                                                                                             | Clean-tree requirement, archive filtering, checksums, reproducibility path reviewed                                  |
| Dependencies              | npm audit production and full tree; Firefox lint bundle warnings                                                                                     | Zero npm advisories; three AMO warnings classified and documented                                                    |

## Attack coverage

| Attack class              | Technique exercised or reasoned                                                                      | Outcome                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Origin confusion          | sender-derived origin, localhost port mismatch, configured-vs-optional host permissions              | One issue fixed; exact-port browser regression passes               |
| Protocol confusion/replay | version overlap, reflected bootstrap, malformed/oversized IDs, client/session correlation            | Rejected and bounded                                                |
| Credential exfiltration   | page storage access, arbitrary destination/header, redirects, raw error/result leakage               | Controls held                                                       |
| Policy bypass             | alias fingerprint drift, standard/audit-first weakening, provider options/tools                      | Controls held                                                       |
| Tool authorization bypass | declaration/input mismatch, approval replay, report state forgery, mutation confirmation suppression | One audit-integrity issue fixed; callback authority held            |
| Resource exhaustion       | request size, output tokens, concurrency, quota reservation, bridge client cardinality               | One client-cardinality issue fixed; limits held                     |
| Persistence/restart       | approval atomicity, private audit exclusion, audit retention/deletion, abandoned quota reservations  | Model/accounting controls held; tool-report restart caveat retained |
| Supply chain/archive      | dependency advisories, packed consumers, browser ZIP contents, source archive                        | Controls held; signing external                                     |

## Verification matrix status

| Requirement group        | Current evidence                                                    | Status                                               |
| ------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------- |
| FR-1–5 runtime           | unit/type tests and sample build                                    | Covered                                              |
| FR-6–10 context          | 11 context tests, including redaction/limits/revision               | Covered                                              |
| FR-11–15 bridge/provider | unit tests plus Chromium/Firefox bridge and live Chromium provider  | Covered                                              |
| FR-16 permission         | Chromium session/persistent grant and revoke path; extension UI     | Covered, denial UI not browser-automated             |
| FR-17–20 modes/audit     | unit tests and Chromium status/control persistence                  | Covered, every approval branch not browser-automated |
| FR-21 lifecycle matrix   | unit/component seams plus selected browser paths                    | Partial; explicit future concern                     |
| FR-22 manifest access    | built manifests, permission docs, exact untrusted-origin regression | Covered; custom-host gesture not browser-automated   |
| FR-23 sample app         | read/write/destructive/context/form example build and Chrome run    | Covered                                              |

## Exclusions and unknowns

- Safari was deliberately excluded and is unsupported.
- No destructive testing against real provider accounts or external store
  infrastructure was performed.
- The authorized live test covered the Anthropic-compatible gateway; Gemini
  remains fixture-only.
- Chrome/AMO submission accounts, signing systems, public privacy/support URL,
  and npm organization controls were unavailable.
- No independent reviewer was used in this pass.
