import { chromium } from "/home/xertrov/.llm-general/skills/headless-browser-screenshots/node_modules/playwright/index.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const extensionPath = join(root, "apps/extension/.output/chrome-mv3");
const outputPath = join(root, "design/screenshots");
const profile = await mkdtemp(join(tmpdir(), "agent-provider-visual-"));

async function snap(page, name, colorScheme, options = {}) {
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: join(outputPath, `${name}-${colorScheme}.png`),
    fullPage: options.fullPage ?? false,
  });
}

const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  executablePath: "/usr/bin/chromium",
  viewport: { width: 1440, height: 1000 },
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});

try {
  let worker = context.serviceWorkers()[0];
  if (worker === undefined)
    worker = await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;

  const app = await context.newPage();
  app.on("console", (message) => {
    if (message.type() === "error")
      console.error("app console:", message.text());
  });
  app.on("pageerror", (error) =>
    console.error("app page error:", error.message),
  );
  await app.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await app.evaluate(() => {
    window.__agentProviderBridgeLog = [];
    window.addEventListener("message", (event) => {
      if (event.data?.channel === "agent-provider.bridge") {
        window.__agentProviderBridgeLog.push({
          clientId: event.data.clientId,
          direction: event.data.direction,
          type: event.data.type,
        });
      }
    });
  });
  await app.getByRole("button", { name: "Ask this page" }).click();
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
  const dashboardStatus =
    (await app.locator(".agent-provider-status").textContent()) ?? "";
  if (dashboardStatus.includes("extension not detected")) {
    throw new Error(
      "The dashboard did not establish an extension bridge session.",
    );
  }
  await snap(app, "dashboard-desktop", "light");
  await snap(app, "dashboard-desktop", "dark");
  await app.setViewportSize({ width: 390, height: 844 });
  await snap(app, "dashboard-mobile", "light");
  await snap(app, "dashboard-mobile", "dark");

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "networkidle",
  });
  await snap(options, "options-desktop", "light");
  await snap(options, "options-desktop", "dark");
  await options.setViewportSize({ width: 390, height: 844 });
  await snap(options, "options-mobile", "light");
  await snap(options, "options-mobile", "dark");

  const appTabId = await options.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.startsWith("http://127.0.0.1:5173/"))
      ?.id;
  });
  if (appTabId === undefined) throw new Error("Could not find the sample tab.");

  const approval = await context.newPage();
  const approvalQuery = new URLSearchParams({
    tabId: String(appTabId),
    origin: "http://127.0.0.1:5173",
    reason:
      "Use declared tools to summarize this account and complete approved operations.",
  });
  await approval.goto(
    `chrome-extension://${extensionId}/approval.html?${approvalQuery}`,
    { waitUntil: "networkidle" },
  );
  await approval.setViewportSize({ width: 760, height: 590 });
  await snap(approval, "approval-desktop", "light", { fullPage: false });
  await snap(approval, "approval-desktop", "dark", { fullPage: false });
  await approval.setViewportSize({ width: 390, height: 640 });
  await snap(approval, "approval-mobile", "light");
  await snap(approval, "approval-mobile", "dark");

  const popup = await context.newPage();
  await options.evaluate(
    (tabId) => chrome.tabs.update(tabId, { active: true }),
    appTabId,
  );
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: "networkidle",
  });
  await popup.setViewportSize({ width: 360, height: 600 });
  await snap(popup, "popup", "light", { fullPage: false });
  await snap(popup, "popup", "dark", { fullPage: false });
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
