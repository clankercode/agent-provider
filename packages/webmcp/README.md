# @agent-provider/webmcp

Progressively mirrors explicitly eligible Agent Provider tools into the WebMCP
API when the browser exposes it.

```bash
npm install @agent-provider/webmcp
```

Read-only tools are eligible by default. Write and destructive tools require
explicit opt-in and retain their application-side authorization requirements.

## What it does

WebMCP is a proposed browser API (`document.modelContext`) that lets a page
register tools for browser-mediated agents. This package adapts an existing
Agent Provider tool map — the same `AgentProviderToolDefinitions` used by
`@agent-provider/runtime` — into that API. Mirrored tools execute through the
original definition, so application-side validation, authorization, and
idempotency handling still apply.

The adapter is optional and off the critical path: when the browser does not
expose `document.modelContext`, `mirrorToolsToWebMcp` reports
`supported: false` instead of throwing, and Agent Provider continues to work
unchanged.

## Quick start

```ts
import { defineAgentProviderTools } from "@agent-provider/runtime";
import { mirrorToolsToWebMcp } from "@agent-provider/webmcp";
import { z } from "zod";

const tools = defineAgentProviderTools({
  get_current_user: {
    description: "Read the signed-in user's profile.",
    inputSchema: z.object({}),
    risk: "read",
    execute: async () => fetchCurrentUser(),
  },
});

const handle = await mirrorToolsToWebMcp(tools);

if (handle.supported) {
  console.log("Mirrored:", handle.registered);
}

// Unregister everything and abort in-flight mirrored calls:
handle.dispose();
```

## Eligibility

A tool is mirrored when either condition holds:

- `webMcp: true` is set on the tool definition, or
- the definition does not set `webMcp: false` and its risk is `"read"`.

Tools with risk `"write"` or `"destructive"` are therefore excluded unless
they explicitly opt in with `webMcp: true`. Opt-in does not weaken the tool's
own authorization requirements; it only makes the tool visible to WebMCP
agents.

Each mirrored invocation receives a fresh idempotency key and shares the
handle's abort signal, so `dispose()` cancels outstanding mirrored calls.

## API

### `mirrorToolsToWebMcp(definitions, options?)`

- `definitions`: `AgentProviderToolDefinitions` from `@agent-provider/runtime`.
- `options.document`: document to read `modelContext` from. Defaults to
  `globalThis.document`.
- `options.exposedTo`: forwarded verbatim to `registerTool` to restrict
  exposure. Omitted from the call when not provided.

Returns a `WebMcpMirrorHandle`:

- `supported`: whether `document.modelContext` was available.
- `registered`: names of the tools actually mirrored.
- `dispose()`: unregisters the tools and aborts their in-flight executions.

If registration fails partway, the mirror aborts and the error is rethrown.

## Requirements

- ESM only.
- A browser environment with a `Document`; the proposed WebMCP API
  (`document.modelContext`) is detected at call time and is not required.
- Node.js 22 or newer for building from source.

## Links

- [Agent Provider repository](https://github.com/clankercode/agent-provider)
- [`@agent-provider/runtime`](https://github.com/clankercode/agent-provider/tree/master/packages/runtime) —
  tool definitions, approvals, and run state
- [`@agent-provider/react`](https://github.com/clankercode/agent-provider/tree/master/packages/react) —
  React bindings and reference UI

## License

CC0-1.0 OR Unlicense.
