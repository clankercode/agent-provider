import { Builder, By } from "selenium-webdriver";
import * as firefox from "selenium-webdriver/firefox.js";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const extensionPath = join(root, "apps/extension/.output/firefox-mv3");
const appOrigin = "http://127.0.0.1:5173";

const server = spawn(
  "npm",
  [
    "run",
    "dev",
    "-w",
    "agent-provider-operations-dashboard",
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    "5173",
    "--strictPort",
  ],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);

let serverOutput = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (chunk) => {
    serverOutput = `${serverOutput}${String(chunk)}`.slice(-4_000);
  });
}

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Fixture server exited early.\n${serverOutput}`);
    }
    try {
      if ((await fetch(appOrigin)).ok) return;
    } catch {
      // The fixture is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Fixture server did not start.\n${serverOutput}`);
}

await waitForServer();

const options = new firefox.Options()
  .setBinary(process.env.FIREFOX_PATH ?? "/usr/bin/firefox")
  .addArguments("-headless")
  .setPreference("xpinstall.signatures.required", false);
const service = new firefox.ServiceBuilder(
  join(root, "node_modules/.bin/geckodriver"),
);
const driver = await new Builder()
  .forBrowser("firefox")
  .setFirefoxOptions(options)
  .setFirefoxService(service)
  .build();

try {
  await driver.installAddon(extensionPath, true);
  await driver.get(appOrigin);

  const ask = await driver.findElement(
    By.xpath("//button[normalize-space()='Ask this page']"),
  );
  await ask.click();

  const statusText = await driver.wait(async () => {
    const statuses = await driver.findElements(
      By.css(".agent-provider-status"),
    );
    if (statuses.length === 0) return false;
    const value = await statuses[0].getText();
    return value.includes("Looking for the extension") ? false : value;
  }, 15_000);

  if (statusText.includes("extension not detected")) {
    throw new Error("The Firefox extension did not establish a page bridge.");
  }
  if (!statusText.includes("Configure a provider")) {
    throw new Error(`Unexpected Firefox bridge state: ${statusText}`);
  }

  const pageStorageType = await driver.executeScript(
    "return typeof globalThis.browser?.storage;",
  );
  if (pageStorageType !== "undefined") {
    throw new Error(
      "Firefox extension storage was exposed to page JavaScript.",
    );
  }

  console.log("Firefox extension runtime smoke passed.");
} finally {
  await driver.quit();
  server.kill("SIGTERM");
}
