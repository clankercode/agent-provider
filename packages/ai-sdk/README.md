# @agent-provider/ai-sdk

An AI SDK `LanguageModel` provider backed by the user-controlled Agent Provider
browser extension.

```bash
npm install @agent-provider/ai-sdk ai
```

Provider credentials remain in the extension. The page selects a configured
model alias and receives structured bridge failures when permission or policy
requirements are not met.

## What it does

This package implements the AI SDK `LanguageModelV4` interface
(`@ai-sdk/provider`) on top of the Agent Provider extension bridge. Instead of
calling a model API directly, the page sends sanitized requests to the
extension over a scoped `postMessage` protocol; the extension applies the
user's origin grants, quotas, and policy, then brokers the call to a
user-configured provider using credentials the page never sees.

Page code passes only allowlisted call options across the boundary: headers and
provider-controlled URLs are stripped, non-function tools are dropped, and raw
chunk inclusion is disabled. The extension re-checks all of this. Failures
(permission denied, quota exhausted, bridge unavailable, timeouts) surface as
typed `AgentProviderBridgeError` instances with `code`, `retryable`, and
`details` fields, or as `AbortError` `DOMException`s on cancellation.

## Requirements

- A browser with the Agent Provider extension installed, and an exact-origin
  grant for the calling page. Without the bridge, `connect()` fails with a
  `BRIDGE_UNAVAILABLE` error.
- A DOM environment: the default transport uses `window.postMessage`,
  `ReadableStream`, `crypto.randomUUID`, and `DOMException`. For non-window
  contexts, supply a custom `AgentProviderBridgeTransport`.
- `ai` (AI SDK) version 7 or newer, `>=7.0.34 <8`.
- ESM only; the package ships a single ESM entry point with TypeScript types.

## Quick start

```ts
import { generateText } from "ai";
import { createAgentProviderProvider } from "@agent-provider/ai-sdk";

const agentProvider = createAgentProviderProvider({ appName: "My App" });

const { text } = await generateText({
  model: agentProvider("default"),
  prompt: "Summarize the current page selection.",
});
```

The argument to the provider is a model alias configured in the extension, not
a provider model ID; it defaults to `"default"`. Streaming works through the
standard AI SDK APIs (`streamText` and friends) with no extra configuration.

## API

- `createAgentProviderProvider(options?)` — returns a provider callable:
  `provider(alias?)` or `provider.languageModel(alias?)` produces an AI SDK
  `LanguageModelV4`; `provider.bridge` exposes the underlying
  `AgentProviderBridge`. Options: `defaultAlias`, `appName`, `clientId`,
  `connectTimeoutMs` (default 3000), `requestTimeoutMs` (default 90000), a
  pre-built `bridge`, or a custom `transport`.
- `createAgentProviderModel(options?)` — convenience escape hatch returning a
  `LanguageModel` directly; accepts `alias` plus the bridge options above.
- `AgentProviderBridge` — lower-level session object. `connect()` opens the
  session and resolves the extension-reported `BridgeCapabilities`;
  `requestPermission()` and `refreshPermission()` drive the consent flow;
  `requestToolApproval()` and `reportToolExecution()` support the tool-use
  contract; `snapshot` holds the latest capabilities; `dispose()` tears down
  all pending work.
- `AgentProviderBridgeError` — structured failure with `code`, `retryable`,
  and `details`.
- `AgentProviderBridgeTransport` / `WindowAgentProviderTransport` — transport
  interface and the default window-based implementation.
- Re-exported protocol types: `BridgeCapabilities`, `BridgeLimits`,
  `PermissionState`.

## Links

- [Repository](https://github.com/clankercode/agent-provider) — extension,
  threat model, and implementation status.
- [`@agent-provider/protocol`](https://github.com/clankercode/agent-provider/tree/master/packages/protocol)
  — the wire protocol and capability types this bridge speaks.

## License

CC0-1.0 OR Unlicense.
