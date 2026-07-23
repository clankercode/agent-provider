import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const STORE_WIDTH = 1280;
const STORE_HEIGHT = 800;
const COMPOSITE_PADDING = 80;

// Store screenshots show this friendly demo origin instead of localhost. The
// dev server is pinned to 127.0.0.1 and chromium maps the hostname there.
const DASHBOARD_ORIGIN = "http://workspace.northstar.test:5173";
const DASHBOARD_URL = `${DASHBOARD_ORIGIN}/`;
const DASHBOARD_HEALTH_URL = "http://127.0.0.1:5173/";
const DASHBOARD_MATCH_PATTERN = "http://workspace.northstar.test/*";

const CHAT_ANSWER =
  "Here is the current picture for Northstar Logistics. The account is on " +
  "the Enterprise plan with $18,420 in monthly spend. The billing contact " +
  "is Rina Patel, and there is a renewal note to confirm annual pricing " +
  "before 31 July. Of the two visible orders, ORD-1042 ($1,890) is paid " +
  "and still awaiting shipment, while ORD-1038 ($4,220) has already " +
  "shipped. Nothing is currently flagged for review or refund.";

const repository = resolve(import.meta.dirname, "..");
const extensionPath = resolve(repository, "apps/extension/.output/chrome-mv3");
const outputPath = resolve(repository, "store/screenshots");
const profilePath = await mkdtemp(
  resolve(tmpdir(), "agent-provider-store-shots-"),
);

await access(resolve(extensionPath, "manifest.json"));
await mkdir(outputPath, { recursive: true });

const produced = [];
const skipped = [];
let dashboardServer;
let chatMockHits = 0;

// The built extension only injects its content script into localhost and only
// accepts bridge sessions from whitelisted demo origins, so patch the
// (gitignored) build output to also cover the screenshot alias. Idempotent;
// source files are never touched.
async function patchBuildForAlias() {
  const manifestPath = resolve(extensionPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const matches = manifest.content_scripts?.[0]?.matches;
  assert.ok(Array.isArray(matches), "manifest content_scripts matches missing");
  if (!matches.includes(DASHBOARD_MATCH_PATTERN)) {
    matches.push(DASHBOARD_MATCH_PATTERN);
    await writeFile(manifestPath, JSON.stringify(manifest));
  }

  // The allowed-origins array is inlined into every bundle that checks it
  // (background worker, popup chunk; chunk hashes vary per build).
  const needle = "`http://127.0.0.1:5173`]";
  const replacement = `\`http://127.0.0.1:5173\`,\`${DASHBOARD_ORIGIN}\`]`;
  const chunkDir = resolve(extensionPath, "chunks");
  const bundlePaths = [resolve(extensionPath, "background.js")];
  try {
    for (const name of await readdir(chunkDir))
      if (name.endsWith(".js")) bundlePaths.push(resolve(chunkDir, name));
  } catch {
    // No chunks directory; background.js alone decides.
  }
  let found = false;
  for (const file of bundlePaths) {
    const source = await readFile(file, "utf8");
    if (source.includes("workspace.northstar.test")) {
      found = true;
      continue;
    }
    if (!source.includes(needle)) continue;
    await writeFile(file, source.replaceAll(needle, replacement));
    found = true;
  }
  assert.ok(
    found,
    "allowed-origins array not found in the extension build; rebuild it",
  );
}

// Polls the dev server directly on loopback (node cannot resolve the alias).
async function waitForDashboard(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(DASHBOARD_HEALTH_URL);
      if (response.ok) return true;
    } catch {
      // Server not up yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  return false;
}

async function startDashboard() {
  dashboardServer = spawn(
    "npm",
    [
      "run",
      "dev",
      "-w",
      "agent-provider-operations-dashboard",
      "--",
      "--host",
      "127.0.0.1",
    ],
    {
      cwd: repository,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        // Vite rejects unknown Host headers; allow the screenshot alias.
        __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: "workspace.northstar.test",
      },
    },
  );
  dashboardServer.on("error", () => {});
  return waitForDashboard();
}

function stopDashboard() {
  if (dashboardServer?.pid === undefined) return;
  try {
    process.kill(-dashboardServer.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

async function flattenPng(file) {
  // Chrome Web Store requires 24-bit PNGs without an alpha channel.
  await promisify(execFile)("convert", [
    file,
    "-alpha",
    "remove",
    "-alpha",
    "off",
    file,
  ]);
}

async function assertStoreDimensions(file) {
  const header = await readFile(file);
  assert.equal(
    header.readUInt32BE(16),
    STORE_WIDTH,
    `${file}: expected width ${STORE_WIDTH}`,
  );
  assert.equal(
    header.readUInt32BE(20),
    STORE_HEIGHT,
    `${file}: expected height ${STORE_HEIGHT}`,
  );
}

async function recordShot(page, name, colorScheme = "light") {
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  await page.evaluate(() => document.fonts.ready);
  const file = resolve(outputPath, name);
  await page.screenshot({ path: file });
  produced.push(file);
  return file;
}

// Center a raw UI capture on a 1280x800 canvas with a neutral backdrop and a
// soft drop shadow. The source image is never upscaled.
async function compositeShot(context, sourceFile, name) {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: STORE_WIDTH, height: STORE_HEIGHT });
    const png = await readFile(sourceFile);
    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
    await page.setContent(`<!doctype html>
<html>
  <body style="margin: 0">
    <div style="width: ${STORE_WIDTH}px; height: ${STORE_HEIGHT}px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);">
      <img id="shot" src="${dataUrl}" style="max-width: ${STORE_WIDTH - 2 * COMPOSITE_PADDING}px; max-height: ${STORE_HEIGHT - 2 * COMPOSITE_PADDING}px; border-radius: 8px; box-shadow: 0 24px 64px rgba(15, 23, 42, 0.25), 0 4px 16px rgba(15, 23, 42, 0.12);" />
    </div>
  </body>
</html>`);
    await page.waitForFunction(() => document.getElementById("shot").complete);
    await recordShot(page, name);
  } finally {
    await page.close();
    await rm(sourceFile, { force: true });
  }
}

// Canned OpenAI Responses API replies for the copilot shot. The background
// service worker posts to /responses; context.route intercepts it.
function chatCompletionJson(model) {
  return JSON.stringify({
    id: "resp-storeshot",
    object: "response",
    created_at: 1_780_000_000,
    model,
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        id: "msg-storeshot",
        content: [{ type: "output_text", text: CHAT_ANSWER, annotations: [] }],
      },
    ],
    usage: { input_tokens: 1_240, output_tokens: 118 },
  });
}

function chatCompletionSse(model) {
  const event = (payload) => `data: ${JSON.stringify(payload)}`;
  const lines = [
    event({
      type: "response.created",
      response: { id: "resp-storeshot", created_at: 1_780_000_000, model },
    }),
  ];
  for (const word of CHAT_ANSWER.split(" ")) {
    lines.push(
      event({
        type: "response.output_text.delta",
        item_id: "msg-storeshot",
        delta: `${word} `,
      }),
    );
  }
  lines.push(
    event({
      type: "response.completed",
      response: {
        usage: { input_tokens: 1_240, output_tokens: 118 },
      },
    }),
  );
  lines.push("data: [DONE]");
  return `${lines.join("\n\n")}\n\n`;
}

await patchBuildForAlias();
const dashboardUp = await startDashboard();
if (!dashboardUp)
  skipped.push("dashboard.png (example dev server did not start)");

const context = await chromium.launchPersistentContext(profilePath, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  viewport: { width: STORE_WIDTH, height: STORE_HEIGHT },
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--host-resolver-rules=MAP workspace.northstar.test 127.0.0.1",
  ],
});

try {
  let worker = context.serviceWorkers()[0];
  if (worker === undefined)
    worker = await context.waitForEvent("serviceworker");
  const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;

  // Mock the provider calls: model catalog for the options page, Responses
  // API calls (issued by the background service worker) for the copilot.
  await context.route("https://api.openai.com/v1/responses", async (route) => {
    chatMockHits += 1;
    let body = {};
    try {
      body = JSON.parse(route.request().postData() ?? "{}");
    } catch {
      // Fall through to the default response.
    }
    const model = typeof body.model === "string" ? body.model : "gpt-5.4-mini";
    if (body.stream === true) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: chatCompletionSse(model),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: chatCompletionJson(model),
      });
    }
  });

  // --- Options page with three configured provider cards ---
  const options = await context.newPage();
  await options.route("https://api.openai.com/v1/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [{ id: "MiniMax-M2.7-highspeed" }, { id: "gpt-5.4-mini" }],
      }),
    });
  });
  await options.goto(`${extensionOrigin}/options.html`, {
    waitUntil: "networkidle",
  });
  await options.getByRole("button", { name: "Add OpenAI" }).click();
  await options.getByRole("button", { name: "Add Anthropic" }).click();
  await options.getByRole("button", { name: "Add Gemini" }).click();
  const cards = options.locator(".profile-card");
  await cards.nth(0).getByLabel("API key").fill("visual-fixture-key");
  await cards.nth(0).getByRole("button", { name: "Pull models" }).click();
  await cards.nth(0).getByText("Available models (2)").waitFor();
  // Point the "default" alias at the fixture profile so the copilot has a
  // credentialed model to call.
  await cards
    .nth(0)
    .getByRole("button", { name: "Use for default alias" })
    .click();
  // Persist the fixture profiles so every other surface (dashboard, approval,
  // popup) shows a configured provider instead of "needs setup".
  await options.getByRole("button", { name: "Save settings" }).click();
  await options.getByText("Settings saved", { exact: true }).waitFor();
  await options.waitForFunction(
    () =>
      document.querySelector(".save-bar")?.getAttribute("aria-hidden") ===
      "true",
  );
  await options.waitForTimeout(300);
  // Zoom out just enough to fit the header and all three profile cards in
  // the viewport (the rest of the settings page stays below the fold).
  await options.evaluate((storeHeight) => {
    const cards = document.querySelectorAll(".profile-card");
    const lastCard = cards[cards.length - 1];
    const bottom = lastCard.getBoundingClientRect().bottom + window.scrollY;
    const zoom = Math.min(1, storeHeight / (bottom + 48));
    document.documentElement.style.zoom = String(zoom);
    window.scrollTo(0, 0);
  }, STORE_HEIGHT);
  await recordShot(options, "options.png", "light");
  await recordShot(options, "options-dark.png", "dark");

  // --- Operations dashboard with an active bridge session ---
  // The dashboard tab is opened via chrome.tabs.create so we learn its tab id
  // directly; chrome.tabs.query cannot read tab URLs without host permissions.
  let appTabId;
  let appOrigin = DASHBOARD_ORIGIN;
  let appPage;
  if (dashboardUp) {
    const appPagePromise = context.waitForEvent("page");
    appTabId = await options.evaluate(
      (url) => chrome.tabs.create({ url }).then((tab) => tab.id),
      DASHBOARD_URL,
    );
    const app = await appPagePromise;
    app.on("pageerror", (error) =>
      console.error("dashboard page error:", error.message),
    );
    await app.waitForLoadState("networkidle");
    await app.evaluate(() => {
      window.__agentProviderBridgeLog = [];
      window.addEventListener("message", (event) => {
        if (event.data?.channel === "agent-provider.bridge") {
          window.__agentProviderBridgeLog.push({
            direction: event.data.direction,
            type: event.data.type,
          });
        }
      });
    });
    await app.getByRole("button", { name: "Ask this page" }).click();
    try {
      await app.waitForFunction(
        () =>
          window.__agentProviderBridgeLog.some(
            (message) =>
              message.direction === "extension-to-page" &&
              message.type === "session.ready",
          ),
        undefined,
        { timeout: 5_000 },
      );
      const status =
        (await app.locator(".agent-provider-status").textContent()) ?? "";
      assert.ok(
        !status.includes("extension not detected"),
        "dashboard did not establish a bridge session",
      );
      await recordShot(app, "dashboard.png", "light");
      appPage = app;
    } catch (error) {
      skipped.push(`dashboard.png (${error.message})`);
      await app.close();
    }
  } else {
    // Approval and popup shots still need a tab id to point at.
    appOrigin = "https://example.com";
    appTabId = await options.evaluate(
      (url) => chrome.tabs.create({ url }).then((tab) => tab.id),
      appOrigin,
    );
  }
  assert.ok(appTabId !== undefined, "could not open a tab for dialog shots");

  // --- Approval dialog, composited onto a 1280x800 backdrop ---
  const approval = await context.newPage();
  const approvalQuery = new URLSearchParams({
    tabId: String(appTabId),
    origin: appOrigin,
    reason:
      "Use declared tools to summarize this account and complete approved operations.",
  });
  await approval.goto(`${extensionOrigin}/approval.html?${approvalQuery}`, {
    waitUntil: "networkidle",
  });
  await approval.setViewportSize({ width: 760, height: 590 });
  await approval.emulateMedia({ colorScheme: "light" });
  await approval.evaluate(() => document.fonts.ready);
  const approvalRaw = resolve(outputPath, ".approval-raw.png");
  await approval.screenshot({ path: approvalRaw });
  await approval.close();
  await compositeShot(context, approvalRaw, "approval.png");

  // --- Toolbar popup, composited onto a 1280x800 backdrop ---
  await options.evaluate(
    (tabId) => chrome.tabs.update(tabId, { active: true }),
    appTabId,
  );
  const popup = await context.newPage();
  const popupQuery = new URLSearchParams({
    tabId: String(appTabId),
    origin: appOrigin,
  });
  await popup.goto(`${extensionOrigin}/popup.html?${popupQuery}`, {
    waitUntil: "networkidle",
  });
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.emulateMedia({ colorScheme: "light" });
  await popup.evaluate(() => document.fonts.ready);
  const popupRaw = resolve(outputPath, ".popup-raw.png");
  await popup.screenshot({ path: popupRaw });
  await popup.close();
  await compositeShot(context, popupRaw, "popup.png");

  // --- Copilot mid-conversation against the mocked provider ---
  if (appPage === undefined) {
    skipped.push("chat.png (dashboard bridge session unavailable)");
  } else {
    try {
      // Clicking Connect drives the real permission flow: the background
      // opens approval.html in a popup window, which we allow and close.
      const approvalWindowPromise = context.waitForEvent(
        "page",
        (page) => page.url().startsWith(`${extensionOrigin}/approval.html`),
        { timeout: 10_000 },
      );
      await appPage
        .getByRole("button", { name: "Connect AgentProvider" })
        .click();
      const approvalWindow = await approvalWindowPromise;
      await approvalWindow
        .getByRole("button", { name: "Allow this tab" })
        .click();
      await approvalWindow.getByText("Decision recorded").waitFor();
      await approvalWindow.close();

      await appPage
        .getByRole("button", { name: "Summarize this account" })
        .click();
      await appPage
        .getByText("renewal note to confirm annual pricing")
        .waitFor({ timeout: 15_000 });
      // Let the stream finish rendering and the transcript scroll settle.
      await appPage.waitForTimeout(400);
      await recordShot(appPage, "chat.png", "light");
      if (chatMockHits === 0)
        console.error("warning: chat mock route never intercepted a request");
    } catch (error) {
      skipped.push(`chat.png (${error.message})`);
    }
  }
} finally {
  await context.close();
  stopDashboard();
  await rm(profilePath, { recursive: true, force: true });
}

for (const file of produced) {
  await flattenPng(file);
  await assertStoreDimensions(file);
}

console.log(`Captured ${produced.length} store screenshots:`);
for (const file of produced)
  console.log(`  ${file} (${STORE_WIDTH}x${STORE_HEIGHT})`);
for (const note of skipped) console.log(`  skipped: ${note}`);
