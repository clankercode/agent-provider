# @agent-provider/protocol

Versioned wire messages, safe-value encoding, guards, and protocol negotiation
for Agent Provider browser bridges.

```bash
npm install @agent-provider/protocol
```

## What it does

Agent Provider is a browser extension that brokers user-controlled LLM access
for trusted web applications: credentials stay in the extension, and access is
granted per exact origin. This package defines the wire contract both sides of
that bridge share:

- **Bootstrap messages** (`hello` / `ready` / `reject`) and version
  negotiation between a page-side client and the extension.
- **Bridge envelopes** — the typed message shapes for sessions, permission
  requests and results, model generate/stream/cancel calls, tool approvals,
  tool execution reports, and structured errors (`BridgeErrorCode`).
- **Wire values** — a safe-value codec (`encodeWireValue` / `decodeWireValue`)
  that carries plain JSON plus `undefined`, `bigint`, `Uint8Array`,
  `ArrayBuffer`, `Date`, and `Error` as tagged values, and rejects functions,
  symbols, class instances, cyclic objects, and non-finite numbers.
- **Guards and constructors** — `isBootstrapMessage`, `isBridgeEnvelope`,
  `isBridgeEnvelopeForDirection`, `isInternalPortMessage`,
  `createBootstrapHello`, `createBootstrapReady`, `createBridgeEnvelope`, and
  `negotiateProtocolVersion`, so every incoming message is validated before it
  is trusted.
- **Canonicalization** — `canonicalize` and `sha256Canonical`, used to
  fingerprint approvals and model-alias authority so a granted operation
  cannot be silently altered before dispatch.

## Quick start

```ts
import {
  createBootstrapHello,
  isBootstrapMessage,
  negotiateProtocolVersion,
  createBridgeEnvelope,
  encodeWireValue,
  decodeWireValue,
} from "@agent-provider/protocol";

const hello = createBootstrapHello({ clientId: "client-1", min: 2, max: 2 });
if (!isBootstrapMessage(hello)) throw new Error("invalid hello");

const version = negotiateProtocolVersion(hello, { min: 1, max: 2 });
if (version === undefined) throw new Error("no protocol overlap");

const envelope = createBridgeEnvelope({
  direction: "page-to-extension",
  clientId: hello.clientId,
  type: "session.open",
  requestId: "req-1",
  payload: { sdkVersion: "0.1.0" },
});

const decoded = decodeWireValue(encodeWireValue({ when: new Date(0) }));
```

Most applications never touch this package directly — it is the shared
foundation under the runtime, React bindings, and the extension itself.
Integrate at that level unless you are building a new bridge implementation.

## Notes

- ESM-only; no CommonJS build is published.
- Intended for browser-capable TypeScript or JavaScript environments: the
  codec uses `btoa` / `atob`, and `sha256Canonical` uses
  `globalThis.crypto.subtle` (available in browsers and Node.js 22+).
- This package defines message shapes and validation only. It does not open
  ports, grant permissions, or hold credentials — that is the extension's job.

## Links

- Repository: <https://github.com/clankercode/agent-provider>
- Sibling packages: `@agent-provider/runtime`, `@agent-provider/context`,
  `@agent-provider/ai-sdk`, `@agent-provider/react`, `@agent-provider/webmcp`

## License

CC0-1.0 OR Unlicense.
