# @agent-provider/context

Bounded, revisioned, application-controlled page context for Agent Provider.

```bash
npm install @agent-provider/context
```

Applications explicitly select context regions; the package does not crawl an
entire page by default. It is ESM-only and requires a DOM-capable environment.

## What it does

Agent Provider lets a trusted web application hand structured page context to a
user-controlled agent. This package is the extraction half of that contract:
the application names the DOM roots that may be observed, and
`createPageContext` turns them into immutable, revisioned frames containing
normalized text content, named regions, redaction records, and truncation
metadata — never live DOM nodes.

Extraction is conservative by default:

- Only elements under the declared roots are read.
- `script`, `style`, `template`, `noscript`, `svg`, and `canvas` content is
  omitted, as is anything under a `hidden` or `aria-hidden="true"` subtree.
- Password, file, and hidden inputs, and form controls whose name, label,
  or autocomplete suggests a token, one-time code, or payment detail, are
  redacted automatically and reported in the frame's `redactions`.
- Elements carrying `data-agent-provider-redact`, or matching an application
  `redact` predicate, are excluded entirely.
- Output is bounded in UTF-8 bytes, nesting depth, region count, and form-value
  size; every limit breach is recorded in `truncation`.

## Quick start

```ts
import { createPageContext } from "@agent-provider/context";

const context = createPageContext({
  roots: () => document.querySelector("main"),
  regions: {
    summary: () => document.querySelector("#summary"),
  },
});

const frame = context.capture(); // revisioned, deeply frozen
console.log(frame.content); // normalized text
console.log(context.getRegion("summary", frame)?.content);
console.log(frame.redactions, frame.truncation);

const delta = context.diff(frame, context.capture());
console.log(delta.contentChanged, delta.changedRegions);
```

Roots and region resolvers run at every capture, so frames track DOM changes
without retaining references. Regions can also be declared in markup with
`data-agent-provider-region="name"`; configured regions take precedence over
attributes with the same name. `full()` is an alias of `capture()` intended
for lazy context-tool integrations. Custom `extractors` can replace the
default rendering of selected elements with application-controlled text.

## Notes

- ESM-only; Node.js 22 or newer. No side effects.
- Requires a DOM: the browser, or a DOM shim such as jsdom for tests.
- Default limits (`DEFAULT_CONTEXT_LIMITS`): 32 KiB total, depth 32,
  128 regions, 4 KiB per form value. Override via the `limits` option with
  positive integers; truncation is UTF-8-aware and never splits a code point.
- A capture only consumes a revision when it succeeds. Redaction paths are
  structural (`root[0]/div[2]/input[0]`) and omit identifiers and field names.

## Links

- Repository: https://github.com/clankercode/agent-provider
- Sibling packages:
  [`@agent-provider/runtime`](https://www.npmjs.com/package/@agent-provider/runtime),
  [`@agent-provider/react`](https://www.npmjs.com/package/@agent-provider/react),
  [`@agent-provider/ai-sdk`](https://www.npmjs.com/package/@agent-provider/ai-sdk),
  [`@agent-provider/webmcp`](https://www.npmjs.com/package/@agent-provider/webmcp)
- Example application:
  [`examples/operations-dashboard`](https://github.com/clankercode/agent-provider/tree/master/examples/operations-dashboard)

## License

CC0-1.0 OR Unlicense.
