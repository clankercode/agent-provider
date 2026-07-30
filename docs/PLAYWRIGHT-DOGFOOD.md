# Playwright dogfood browser + approval automation

How to drive Agent Provider with a **named persistent Chromium profile** and
control the **separate approval window** during end-to-end tests.

## Launch (named profile + CDP)

```bash
cd ~/src/agent-provider
npm run build:extension   # apps/extension/.output/chrome-mv3

PROFILE_NAME=agent-provider-dogfood \
START_URL=http://10.42.0.8:15066/ \
CDP_PORT=9333 \
CHROMIUM_PATH=/usr/bin/chromium \
node scripts/launch-agent-provider-browser.mjs
```

| Item | Value |
| --- | --- |
| Script | `scripts/launch-agent-provider-browser.mjs` |
| Profile dir | `~/.cache/agent-provider/playwright-profiles/<PROFILE_NAME>` |
| CDP | `http://127.0.0.1:9333` (also `<profile>/.cdp-endpoint`) |
| Extension id | written to `<profile>/.extension-id` after SW starts |
| Extension path | `apps/extension/.output/chrome-mv3` via `--load-extension` |

Leave the launcher process running. Settings, grants, and storage persist
across relaunches of the same `PROFILE_NAME`.

Attach Playwright:

```js
import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const context = browser.contexts()[0];
```

Do **not** call `browser.close()` on a CDP connection if you want the headed
dogfood window to stay open — exit the Node process without closing.

## Approval windows (important)

Page access grants and step approvals open as a **separate extension popup
window**, not an in-page modal:

```
chrome-extension://<id>/approval.html?tabId=<n>&origin=<encoded>&reason=...
# or
chrome-extension://<id>/approval.html?approvalId=<uuid>
```

Background code uses `browser.windows.create({ type: "popup", focused: true })`.

### Finding the approval page in Playwright

```js
// Prefer exact URL match — options.html also contains "Allow" strings.
let approval = context.pages().find((p) =>
  (p.url() || "").includes("approval.html"),
);

// Or wait when clicking Connect / Request access:
const pagePromise = context.waitForEvent("page", { timeout: 10_000 });
await page.getByRole("button", { name: /Connect Agent Provider|Request access/i }).click();
approval = await pagePromise;
// rescan if needed:
approval =
  context.pages().find((p) => (p.url() || "").includes("approval.html")) ??
  approval;
```

**Pitfall:** scanning all extension pages and picking the first body that
matches `/allow|grant/i` often selects **options.html** (provider UI copy).
Always filter on `approval.html`.

### Deciding

Permission prompts (page access):

| Control | Effect |
| --- | --- |
| **Allow this tab** | `grant-session` — ends when tab closes |
| **Always allow origin** | `grant-persistent` — revocable in settings |
| **Deny request** | deny |

```js
await approval.bringToFront();
await approval.getByRole("button", { name: /Allow this tab/i }).click();
// finished state: "Request allowed" + Close window
await approval.getByRole("button", { name: /Close window/i }).click().catch(() => {});
```

Step approvals (`approvalId=…`) use Approve / Deny (and tool-limit grant
controls). Same page component: `entrypoints/approval/ApprovalApp.tsx`.

### After grant: page may stay stale

The host page often still shows **“This page needs permission…”** until the
user clicks **Connect** again (or reloads). Automation should:

1. Click Allow in `approval.html`
2. Bring the app tab forward
3. Click Connect / Request access once more
4. Wait until the chat textarea is enabled and the status row clears

This is a known product gap (page does not auto-refresh capabilities after the
approval window decides).

## Approving from Settings (no popup focus)

Options → **Pending requests** lists in-flight permission and step approvals
(polled ~2.5s). From there you can:

- **Review / approve** — re-open the dedicated approval window
- **Allow tab** / **Deny** — decide page-access grants inline (permission kind)

UI messages (extension pages only):

| type | purpose |
| --- | --- |
| `pending.list` | `{ ok, pending: PendingRequestView[] }` |
| `pending.open` | focus/recreate approval window for one item |
| `permission.set` | grant/deny/revoke (requires trusted tabId+origin) |
| `approval.get` / `approval.decide` | step approvals by id |

Useful when the popup is behind other windows or CDP lost the page event.

## Lifecycle checklist (control-plane dogfood)

1. CS CONTROL_TOKEN set (Auth page **inline field**, not `window.prompt`).
2. Unpacked extension = current `chrome-mv3` build; hard-refresh app tab.
3. Page console: `[agent-provider] content script active` → `bootstrap ready`.
4. Dock visible top-right when presence probe succeeds.
5. Connect → `approval.html` → Allow this tab → Connect again → chat ready.
6. If model calls fail with tool-limit text, raise **Max tools** in options or
   reduce the page tool surface (default extension cap is 32).

## Related

- Integrator guide: [INTEGRATING.md](./INTEGRATING.md)
- Launcher script: `scripts/launch-agent-provider-browser.mjs`
- Approval UI: `apps/extension/entrypoints/approval/`
- Options pending UI: `apps/extension/entrypoints/options/OptionsApp.tsx`
