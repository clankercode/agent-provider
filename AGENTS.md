# Agent Provider — Agent Guide

## Version markers in docs and code

When adding a new feature, API, prop, or any user-visible change, annotate it
with a version marker so consumers know when it landed. Use the placeholder
**`NEXT_VERSION`** in source — never guess the real version number.

### Convention

- In **docs** (`.md` files), use a blockquote callout:

  ```md
  > **New in NEXT_VERSION** — description of the feature.
  ```

- In **code comments** and **JSDoc**, use inline:

  ```ts
  /** New in NEXT_VERSION: override the chat header subtitle. */
  ```

- In **README** package docs, add a badge or callout:

  ```md
  **New in NEXT_VERSION**
  ```

### Ossification at release time

When cutting a release (`npm run release -- X.Y.Z` or `just release X.Y.Z`),
the release script replaces every `NEXT_VERSION` occurrence with the actual
version number across docs, READMEs, and source comments before committing
and tagging. See `RELEASE.md` for the release process.

If you are manually editing docs after the release script has run, use the
real version number (e.g. `New in 0.2.0`) — `NEXT_VERSION` only exists
between releases.

### What to annotate

Annotate anything a consumer (integrating website, extension user, or
downstream package) would want to know the introduction version for:

- New React component props
- New runtime methods or getters
- New protocol fields or message types
- New CLI flags or config options
- Breaking changes (use `**Changed in NEXT_VERSION**` or
  `**Breaking in NEXT_VERSION**`)
- New debug/dev-only tools or features

Do **not** annotate internal refactors, test-only changes, or private
implementation details that consumers never see.

## Build and test

```bash
npm run build           # full monorepo build (packages + extension + examples)
npm run build:packages  # just the publishable packages
npm run build:extension # just the browser extension
npm test                # unit tests (73 tests across 15 files)
npm run typecheck       # tsc --noEmit for all workspaces
npm run format          # prettier check
```

### Pre-existing tsc errors (ignore these)

The extension tsconfig has known pre-existing errors in:

- `application-origin.ts` (match pattern types)
- `wxt.config.ts` auto-imports (`getURL`, `defineBackground`)
- `@ai-sdk/*` node type references (`Buffer`, `node:http`)

These are not caused by your changes. Filter them:

```bash
npx tsc -p apps/extension/tsconfig.json --noEmit 2>&1 | \
  grep -v "application-origin\|getURL\|defineBackground\|Buffer\|PublicPath\|node:http"
```

### Live integration tests

Live tests use the LLMP provider and are excluded from the default test run.
They match `*.live.test.ts` and require a key file (never echo it):

```bash
cd packages/runtime && npx vitest run --config vitest.live.config.ts
```

Key file: `~/.llmp-key-agent-provider`. Model: `glm-5-turbo`.
Endpoint: `https://omni-dyn-00.amaroolabs.com/v1`.

## Monorepo structure

```
packages/protocol   — wire protocol, guards, canonical encoding, SHA-256
packages/runtime    — headless agent runtime, tools, approvals, debug tools
packages/react      — React bindings, reference chat UI, launcher
packages/ai-sdk     — AI SDK language model bridge
packages/context    — bounded page-context extraction
packages/webmcp     — WebMCP tool mirroring
apps/extension      — browser extension (WXT, Chrome MV3 + Firefox MV3)
examples/           — consumer app examples
docs/               — integration guides, threat model, status
```

## Conventions

- TypeScript strict mode with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`.
- ESM-only everywhere (`"type": "module"`).
- All packages are version-locked: they share one version and pin
  `@agent-provider/*` dependencies exactly. The release script handles this.
- Never brand "Amaroo" or "amaroolabs" inside this repo — the product is
  generic. Dogfood IPs are fine unlabeled.
- Git commit identity is configured globally (Max Kaye <m@xk.io>) — just run
  `git commit` directly.
