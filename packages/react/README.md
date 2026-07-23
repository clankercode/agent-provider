# @agent-provider/react

React bindings and a reference chat surface for Agent Provider.

```bash
npm install @agent-provider/react react react-dom
```

Import `@agent-provider/react/styles.css` when using the reference UI. The
headless runtime remains available separately from `@agent-provider/runtime`.

## What it does

Agent Provider lets a trusted web application run a typed, tool-using AI agent
without owning the user's model credentials. Credentials live in the browser
extension and are only released to an origin after an explicit, exact-origin
grant; page code never sees them. This package provides the React half of that
contract: a context provider and hooks that expose the runtime's observable
state, plus a reference chat surface (`AgentProviderChat` and
`AgentProviderLauncher`) that handles connection status, permission prompts,
tool-approval requests, and streaming messages out of the box.

## Quick start

Create a runtime with `@agent-provider/runtime`, hand it to
`AgentProviderProvider`, and render the launcher:

```tsx
import { instantChatbot } from "@agent-provider/runtime";
import {
  AgentProviderProvider,
  AgentProviderLauncher,
} from "@agent-provider/react";
import "@agent-provider/react/styles.css";

const runtime = instantChatbot({
  appName: "My App",
  modelAlias: "default",
  instructions: "You are the copilot for this page.",
});

export function App() {
  return (
    <AgentProviderProvider runtime={runtime} destroyOnUnmount>
      <AgentProviderLauncher title="My App copilot" />
    </AgentProviderProvider>
  );
}
```

Model execution requires the Agent Provider browser extension and an
exact-origin grant from the user; without them the surface renders a status
message instead of a working chat.

## Exports

Components:

- `AgentProviderProvider` — supplies an `AgentProviderRuntime` to the tree.
  Pass `destroyOnUnmount` to destroy the runtime when the provider unmounts.
- `AgentProviderChat` — inline reference chat surface: transcript, composer,
  connection/permission status, approvals, and tool activity.
- `AgentProviderLauncher` — toggleable button that opens an `AgentProviderChat`
  panel.

Hooks (must be used inside `AgentProviderProvider`):

- `useAgentProviderRuntime()` — the runtime instance.
- `useAgentProviderState()` — the current `AgentProviderRuntimeState`
  (connection, run state, messages, approvals, tool activity), subscribed via
  `useSyncExternalStore`.

Props and component-override types: `AgentProviderProviderProps`,
`AgentProviderChatProps`, `AgentProviderLauncherProps`, and
`AgentProviderChatComponents` (override the `Button`, `Textarea`, `Message`,
`Approval`, and `Activity` slots of the reference UI).

## Notes

- ESM-only. Requires React and React DOM 18.3 or newer (peer dependencies).
- The reference UI runs in the page's DOM; it needs a browser environment and
  a page willing to host it. The runtime itself never reads the DOM directly —
  page context is supplied explicitly, e.g. via `@agent-provider/context`.
- `styles.css` is only needed for the reference UI; headless usage through the
  hooks needs no stylesheet. The CSS is the package's only declared side
  effect.
- Provider credentials are configured in the extension, never in page code.
  Every page tool keeps ordinary server-side authorization and validation; see
  the repository's threat model.

## Links

- Repository: <https://github.com/clankercode/agent-provider>
- `@agent-provider/runtime` — headless runtime, tools, approvals, run state.
- `@agent-provider/context` — bounded, revisioned page-context extraction.
- `examples/operations-dashboard` in the repository — a runnable trusted-app
  integration using this package.

## License

CC0-1.0 OR Unlicense.
