# Integrating Agent Provider into a web app

This is the first-stop guide for application developers (and coding agents)
wiring a trusted page to the Agent Provider browser extension.

## What you get

- Page-owned tools + UI (you control context and mutations).
- Extension-owned model credentials and provider network calls.
- Exact-origin consent: the page never sees API keys.

> **New in NEXT_VERSION** — The chat header now shows the real model name and tool
> count by default (`Page tools (42) · Model: gpt-5-mini high`). Override with
> the `headerLabel` prop (string or `(info) => string`). Assistant messages
> render markdown. There's an in-progress thinking animation, tool-call
> indicators (expandable, live status), and error icons. The launcher can be
> dragged out of its docked corner. The protocol package now works on non-secure
> HTTP origins (pure-JS SHA-256 fallback when `crypto.subtle` is unavailable).

## Install packages

```bash
npm install @agent-provider/runtime @agent-provider/react @agent-provider/protocol
# optional:
npm install @agent-provider/context @agent-provider/ai-sdk
```

Import the reference UI stylesheet if you use `AgentProviderChat` /
`AgentProviderLauncher`:

```ts
import "@agent-provider/react/styles.css";
```

## Minimal React integration

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
  tools: {
    // declare page tools here
  },
});

export function Copilot() {
  return (
    <AgentProviderProvider runtime={runtime} destroyOnUnmount>
      <AgentProviderLauncher
        title="My App copilot"
        placement="top-right"
        insets={{ top: "3.5rem", right: "1rem" }}
      />
    </AgentProviderProvider>
  );
}
```

### Launcher placement (first-class)

| Prop / attribute | Purpose |
| --- | --- |
| `placement` / `data-placement` | `bottom-right` (default), `bottom-left`, `top-right`, `top-left` |
| `insets` / `--agent-provider-inset-*` | Edge offsets (`number` → px, or CSS length string) |
| `visible` / `data-visible` | Fade the whole launcher (probe gating) |

Hosts may set `data-placement` and CSS variables themselves if they build a
custom dock (as control-server does) instead of using `AgentProviderLauncher`.

### Chat surface props (NEXT_VERSION additions)

**New in NEXT_VERSION** — `AgentProviderChat` and `AgentProviderLauncher` gained
these props:

| Prop | Type | Default | Purpose |
| --- | --- | --- | --- |
| `headerLabel` | `string \| ((info: { toolCount: number; modelLabel: string }) => string)` | auto | Override the subtitle. Default: `Page tools (n) · Model: gpt-5-mini high` |
| `thinkingColor` | `string` | accent | CSS color for the thinking dots animation (also settable via `--agent-provider-thinking`) |
| `markdown` | `boolean` | `true` | Render assistant messages with markdown (bold, italic, code, links, headings, lists) |
| `draggable` | `boolean` | `false` | Let the launcher panel be dragged out of its docked corner |
| `showToolActivity` | `boolean` | `true` | Show collapsible tool-call indicators in the transcript |

`headerLabel` examples:

```tsx
// Fixed string
<AgentProviderLauncher headerLabel="Copilot" />

// Custom format with template
<AgentProviderLauncher
  headerLabel={({ toolCount, modelLabel }) =>
    `🛠️ ${toolCount} tools · 🤖 ${modelLabel}`
  }
/>
```

Tool-call indicators show a colored status dot (pulsing = running, accent =
done, red = failed/denied, gold = awaiting approval), the tool name, and the
phase. Click to expand; arguments and results are collapsed by default.

The drag handle appears above the chat when `draggable` is set. Drag the panel
to pop it out to a fixed position; click **Dock** to return it to the corner.

## Connection states (presence vs grant)

`runtime.connect()` / auto-connect probes the **extension bridge**, not the
model grant. Treat these separately:

| `state.connection` | Meaning | Typical UI |
| --- | --- | --- |
| `idle` / `connecting` | Probe in flight | Hide launcher or show skeleton |
| `ready` | Extension answered; check `capabilities.permission` | Show launcher. If permission is not granted, prompt “Allow in extension” |
| `needs-enable` | Extension is present on the host, but this **exact origin** is not enabled | Show launcher + “Open popup → Enable on this site → reload” |
| `unavailable` | No content script answered (extension missing, or origin never enabled so nothing is injected) | **Hide** product chrome that depends on AP |
| `error` | Bridge error (version mismatch, etc.) | Show recoverable error |

Model grant is **not** a connection failure:

- `capabilities.permission === "prompt"` → ask the user to allow the tab in the popup (or call `runtime.requestPermission()`).
- Status copy should say something like: **“Please allow this page in the Agent Provider extension.”**

### Recommended host visibility rule

```ts
const probeSettled =
  connection !== "idle" && connection !== "connecting";
const showDock = probeSettled && connection !== "unavailable";
```

That shows the dock once the extension is present **even before** the user
grants model access, and hides it when AP is not installed / not injected.

## Origin enablement (Chrome rules that bite)

Two different browser concepts:

1. **Host permission** — exact origin pattern with port is fine:  
   `http://10.42.0.8:15066/*` via `permissions.request`.
2. **Content-script match patterns** — host-based; **do not rely on ports** the
   same way (Firefox cannot encode ports; Chromium match patterns are
   host-oriented). Agent Provider registers `http://10.42.0.8/*` for injection
   and **re-checks the exact sender origin** in the background worker against
   the user’s enabled-origin list.

So for a LAN control plane on a non-default port:

1. User opens the extension popup on that tab.
2. **Enable site & allow this tab** (or Enable on this site only, then Allow).
3. Tab reloads with the content script injected.
4. Page auto-connect should reach `ready` (or `prompt` permission).

If enable “succeeds” but the page still says extension not detected, inspect:

- Page console: `[agent-provider] content script active`
- Extension service worker console: `[agent-provider] onConnect` / `bootstrap ready`
- `chrome://extensions` → Agent Provider → **Inspect views: service worker**

### Build-time allowlist vs optional enable

`apps/extension/agent-provider.config.ts` lists origins that are always
injected (dev defaults: `http://localhost:5173`, `http://127.0.0.1:5173`).
Everything else requires a user gesture (**Enable on this site**).

Optional HTTP is limited to **private/local** hosts (loopback, RFC1918,
link-local, `.localhost` / `.local`). Public cleartext HTTP cannot be enabled.

## Status UX contract (reference chat)

`AgentProviderChat` keeps a stable status row:

- Fixed grid: message + action column (min height) so the Connect button
  appearing/disappearing does not reflow the layout.
- Tones: `error` (unavailable / needs-enable / error), `warn` (ready but
  needs allow), `info` (probing / config).
- Copy points at the fix, not just the failure.

## Dogfood / LAN control planes

For local control-plane dogfood the build-time allowlist includes:

- `http://10.42.0.8:15066` (mesh)
- `http://10.100.1.2:15066` (LAN)

Those origins inject via static content-script host matches (`http://10.42.0.8/*`,
`http://10.100.1.2/*`). Exact-origin checks still apply in the background, so
other ports on the same host do not get a bridge session without an explicit
optional enable.

After reloading an unpacked extension, open the control-plane tab and hard
refresh once so the content script attaches. Optional (non-allowlisted) origins
are re-registered automatically from stored enable grants on worker start.

## Debugging checklist

1. Confirm unpacked extension is the build you think it is  
   (`apps/extension/.output/chrome-mv3`).
2. On the tab, open DevTools → Console; filter `agent-provider`.
3. Extension service worker logs: `[agent-provider] setOriginBridge`,
   `registered content script`, `onConnect`, `bootstrap ready|reject`.
4. Popup status: `bridgeEnabled`, `permission`, provider configured.
5. Page runtime: `useAgentProviderState().connection` and `.capabilities`.
6. Missed approval window → Options → **Pending requests** (or see
   [PLAYWRIGHT-DOGFOOD.md](./PLAYWRIGHT-DOGFOOD.md) for CDP control of
   `approval.html`).

## Playwright / automation

Named profile + CDP launcher and how to drive the **separate approval window**:
[PLAYWRIGHT-DOGFOOD.md](./PLAYWRIGHT-DOGFOOD.md).

## Threat model reminder

- An exact origin is one trust principal. XSS on a granted origin is full
  agent authority for that origin.
- Page tools must keep server-side auth, validation, and business limits.
- Never put provider API keys in page code or content scripts.

See also: [THREAT-MODEL.md](./THREAT-MODEL.md), package READMEs under
`packages/*/README.md`, and `examples/operations-dashboard`.
