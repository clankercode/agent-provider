# @agent-provider/runtime

Headless Agent Provider runtime with typed tools, observable run state,
context lifecycle, and page-native mutation approval.

```bash
npm install @agent-provider/runtime
```

The runtime is UI-agnostic and ESM-only. Browser extension installation and an
explicit exact-origin grant are required for model execution.

## What it does

`@agent-provider/runtime` lets a trusted web application run a typed,
tool-using agent without owning the user's model credentials. The application
declares tools with schemas, risk levels, and confirmation rules; the Agent
Provider browser extension brokers access to a user-configured model provider,
mediates approvals, and keeps credentials out of page JavaScript.

The runtime exposes a single observable state object (connection, run state,
messages, tool activity, pending approvals) with a subscribe/getSnapshot
interface, so any UI layer can render it. Expected failures — permission
denied, policy denial, timeout, cancellation, bridge loss — resolve as
structured outcomes, not unhandled exceptions.

## Quick start

```ts
import { instantChatbot } from "@agent-provider/runtime";
import { z } from "zod";

const runtime = instantChatbot({
  appName: "Example App",
  instructions: "Use tools instead of inventing page data.",
  tools: {
    get_title: {
      description: "Return the current document title.",
      inputSchema: z.object({}),
      risk: "read",
      execute: () => document.title,
    },
  },
});

const unsubscribe = runtime.subscribe(() => {
  const state = runtime.getSnapshot();
  // Render state.messages, state.approvals, state.toolActivity in your UI.
});

await runtime.connect();
await runtime.requestPermission("Read page data to answer questions.");
const outcome = await runtime.send("What is this page about?");
// outcome is { ok: true, code: "completed" } or { ok: false, code, message, retryable }.
```

Any schema library supported by the AI SDK works for `inputSchema` (Zod shown
above). `createAgentRuntime` is an alias of `instantChatbot`; use the
`AgentProviderRuntime` class directly when you need to supply your own
`LanguageModel` or bridge.

## Approvals

Tools carry a `risk` of `"read"`, `"write"`, or `"destructive"`. Read tools run
without in-page confirmation by default; write and destructive tools pause for
explicit user approval unless a `confirmation` rule says otherwise. When the
extension bridge is connected, consequential calls are also subject to
extension-side approval and are reported to the extension for audit.

Pending approvals appear in `state.approvals`; resolve them from your UI with
`runtime.resolveApproval(id, approved)`. Unresolved approvals time out
(`maxApprovalWaitMs`, default 120 seconds) and deny.

## Notes

- ESM-only, `sideEffects: false`, requires Node.js 22 or newer.
- The bridge talks to the extension over `window.postMessage`; a page context
  is required for extension-mediated execution.
- Page context is opt-in and bounded: pass a `PageContext` from
  `@agent-provider/context` — the runtime never reads the DOM directly.
- Tool outputs are capped at 256 KiB per call.
- Call `runtime.destroy()` on teardown; it cancels active runs and pending
  approvals and disposes the bridge.

## Links

- Repository: https://github.com/clankercode/agent-provider
- `@agent-provider/context` — bounded, revisioned page-context extraction.
- `@agent-provider/react` — React bindings and reference chat UI for this
  runtime.
- `@agent-provider/ai-sdk` — the underlying AI SDK `LanguageModel` bridge.

## License

CC0-1.0 OR Unlicense.
