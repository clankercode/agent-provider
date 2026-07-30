#!/usr/bin/env node
/**
 * Launch a headed Chromium with a named persistent profile and the built
 * Agent Provider extension loaded. Intended for interactive setup + agent
 * automation (CDP stays open until you stop this process).
 *
 * Usage:
 *   node scripts/launch-agent-provider-browser.mjs
 *   START_URL=http://10.42.0.8:15066 node scripts/launch-agent-provider-browser.mjs
 *   PROFILE_NAME=dogfood HEADLESS=1 node scripts/launch-agent-provider-browser.mjs
 *
 * Profile dir (default):
 *   ~/.cache/agent-provider/playwright-profiles/<PROFILE_NAME>
 *
 * CDP endpoint is printed and written to:
 *   <profile>/.cdp-endpoint
 */
import { chromium } from "playwright-core";
import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const extensionPath = join(root, "apps/extension/.output/chrome-mv3");
const profileName = process.env.PROFILE_NAME ?? "agent-provider-dogfood";
const profilesRoot =
  process.env.AP_PLAYWRIGHT_PROFILES ??
  join(homedir(), ".cache/agent-provider/playwright-profiles");
const profilePath = join(profilesRoot, profileName);
const startUrl =
  process.env.START_URL ?? "http://10.42.0.8:15066/";
const headless = process.env.HEADLESS === "1";
const executablePath =
  process.env.CHROMIUM_PATH ??
  process.env.CHROME_PATH ??
  "/usr/bin/chromium";
const cdpPort = Number(process.env.CDP_PORT ?? "9333");

await access(join(extensionPath, "manifest.json"));
await mkdir(profilePath, { recursive: true });

console.log(`[ap-browser] profile: ${profilePath}`);
console.log(`[ap-browser] extension: ${extensionPath}`);
console.log(`[ap-browser] start: ${startUrl}`);
console.log(`[ap-browser] cdp: http://127.0.0.1:${cdpPort}`);

const context = await chromium.launchPersistentContext(profilePath, {
  headless,
  executablePath,
  viewport: { width: 1440, height: 1000 },
  ignoreDefaultArgs: ["--enable-automation"],
  args: [
    `--remote-debugging-port=${cdpPort}`,
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

await writeFile(
  join(profilePath, ".cdp-endpoint"),
  `http://127.0.0.1:${cdpPort}\n`,
  "utf8",
);
await writeFile(
  join(profilePath, "README.txt"),
  [
    "Agent Provider Playwright persistent profile",
    `name: ${profileName}`,
    `path: ${profilePath}`,
    `extension: ${extensionPath}`,
    `cdp: http://127.0.0.1:${cdpPort}`,
    "",
    "Configure the extension (provider key, aliases) in this browser window.",
    "Settings persist across launches of this profile.",
    "",
  ].join("\n"),
  "utf8",
);

// Wait for MV3 service worker so we can open options/popup reliably.
let worker = context.serviceWorkers()[0];
if (worker === undefined) {
  try {
    worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  } catch {
    console.warn("[ap-browser] service worker not ready yet; continuing");
  }
}

let extensionOrigin;
if (worker !== undefined) {
  extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
  console.log(`[ap-browser] extension id: ${new URL(worker.url()).host}`);
  await writeFile(
    join(profilePath, ".extension-id"),
    `${new URL(worker.url()).host}\n`,
    "utf8",
  );
}

const page = context.pages()[0] ?? (await context.newPage());
page.on("console", (message) => {
  const type = message.type();
  if (type === "error" || type === "warning") {
    console.log(`[page:${type}] ${message.text()}`);
  }
});

await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch((error) => {
  console.warn(`[ap-browser] start url failed: ${error.message}`);
});

if (extensionOrigin !== undefined) {
  const options = await context.newPage();
  await options.goto(`${extensionOrigin}/options.html`, {
    waitUntil: "domcontentloaded",
    timeout: 15_000,
  }).catch((error) => {
    console.warn(`[ap-browser] options open failed: ${error.message}`);
  });
  console.log(`[ap-browser] opened options: ${extensionOrigin}/options.html`);
}

console.log("");
console.log("Browser is ready. Configure Agent Provider in this window.");
console.log("Leave this process running for CDP automation.");
console.log(`Connect via: http://127.0.0.1:${cdpPort}`);
console.log("Stop with Ctrl+C.");

const shutdown = async () => {
  console.log("\n[ap-browser] closing…");
  try {
    await context.close();
  } catch {
    // already closed
  }
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

// Keep alive until user stops us.
await new Promise(() => {});
