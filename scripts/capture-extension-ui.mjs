import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const repository = resolve(import.meta.dirname, "..");
const extensionPath = resolve(repository, "apps/extension/.output/chrome-mv3");
const outputPath = resolve(
  process.argv[2] ?? resolve(repository, "artifacts/visual-qa"),
);
const profilePath = await mkdtemp(
  resolve(tmpdir(), "agent-provider-visual-qa-"),
);

await access(resolve(extensionPath, "manifest.json"));
await mkdir(outputPath, { recursive: true });

const context = await chromium.launchPersistentContext(profilePath, {
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
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
  const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
  const page = await context.newPage();
  await page.route("https://api.openai.com/v1/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [{ id: "MiniMax-M2.7-highspeed" }, { id: "gpt-5.4-mini" }],
      }),
    });
  });
  await page.goto(`${extensionOrigin}/options.html`, {
    waitUntil: "networkidle",
  });
  const saveBar = page.locator(".save-bar");
  assert.equal(await saveBar.getAttribute("aria-hidden"), "true");

  await page.getByRole("button", { name: "Add OpenAI" }).click();
  await page.getByRole("button", { name: "Add Anthropic" }).click();
  await page.getByRole("button", { name: "Add Gemini" }).click();
  const cards = page.locator(".profile-card");
  await cards.nth(0).getByLabel("API key").fill("visual-fixture-key");
  await cards.nth(0).getByRole("button", { name: "Pull models" }).click();
  await cards.nth(0).getByText("Available models (2)").waitFor();
  await page.evaluate(() => document.fonts.ready);

  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: resolve(outputPath, `options-desktop-${colorScheme}.png`),
      fullPage: true,
    });
    await page.screenshot({
      path: resolve(outputPath, `options-savebar-${colorScheme}.png`),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: resolve(outputPath, `options-mobile-${colorScheme}.png`),
      fullPage: true,
    });
  }

  assert.equal(await saveBar.getAttribute("aria-hidden"), "false");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.getByText("Settings saved", { exact: true }).waitFor();
  await page.waitForTimeout(2_600);
  assert.equal(await saveBar.getAttribute("aria-hidden"), "true");

  console.log(`Captured extension visual QA in ${outputPath}`);
} finally {
  await context.close();
  await rm(profilePath, { recursive: true, force: true });
}
