# Firefox reviewer notes

Build from the full source archive at repository root:

```bash
npm ci
npm run build:firefox
npm run test:firefox
```

The upload artifact is a Manifest V3 extension. `web-ext lint` reports zero
errors and three dependency-originated warnings:

- two `innerHTML` warnings are emitted from React's packaged JSX runtime; the
  extension does not pass page/provider content to `dangerouslySetInnerHTML`;
- one `Function` warning is Zod's feature probe for optional JIT schema
  compilation. It does not evaluate extension, page, provider, or remote text.

The extension contains no remote executable code. Provider responses remain
data and are decoded through bounded protocol/result policies. The submitted
full source archive includes the root lockfile, workspaces, tests, and build
configuration needed to reproduce the bundle.
