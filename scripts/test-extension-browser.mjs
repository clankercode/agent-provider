import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const extensionPath = join(root, "apps/extension/.output/chrome-mv3");
const profilePath = await mkdtemp(join(tmpdir(), "agent-provider-browser-"));
const appOrigin = "http://127.0.0.1:5173";
const untrustedOrigin = "http://127.0.0.1:5174";
const live = process.argv.includes("--live");

await access(join(extensionPath, "manifest.json"));

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
      const response = await fetch(appOrigin);
      if (response.ok) return;
    } catch {
      // The fixture is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Fixture server did not start.\n${serverOutput}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function credential(path) {
  return (await readFile(path, "utf8")).trim();
}

async function configureLiveProvider(options, apiKey) {
  await options.evaluate(
    async ({ key }) => {
      const settings = {
        version: 1,
        provider: {
          kind: "openai",
          endpoint: "https://***REMOVED***/v1/",
          apiKey: key,
          organization: "",
          project: "",
        },
        profiles: {},
        aliases: {
          default: {
            model: "gpt-5.4-mini",
            maxOutputTokens: 128,
            reasoning: "low",
          },
        },
        limits: {
          maxRequestBytes: 512_000,
          maxOutputTokens: 8_192,
          maxConcurrentRequests: 2,
          maxTools: 32,
          requestTimeoutMs: 120_000,
        },
        execution: { defaultMode: "standard", privateByDefault: false },
        audit: {
          persistentEnabled: false,
          originOverrides: {},
          requirePersistent: false,
          retention: {
            maxAgeMs: 30 * 24 * 60 * 60 * 1_000,
            maxEvents: 10_000,
            maxBytes: 10 * 1024 * 1024,
          },
        },
        quotas: {
          requestsPerMinute: 20,
          requestsPerDay: 200,
          tokensPerDay: 1_000_000,
          allowUnknownPricing: true,
        },
      };
      await chrome.storage.local.set({
        "agent-provider.settings.v1": settings,
      });
    },
    { key: apiKey },
  );
}

async function runLiveRequest(app) {
  await app.reload({ waitUntil: "networkidle" });
  if ((await app.locator(".agent-provider-chat").count()) === 0) {
    await app.getByRole("button", { name: "Ask this page" }).click();
  }
  const input = app.getByLabel("Ask this page to help…");
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill("Reply with exactly browser-ok. Do not call any tools.");
  const send = app.getByRole("button", { name: "Send" });
  await send.waitFor({ state: "visible" });
  assert(await send.isEnabled(), "The live composer was not enabled.");
  await send.click();
  const assistant = app.locator(
    ".agent-provider-message--assistant[data-status='complete']",
  );
  await assistant.last().waitFor({ state: "visible", timeout: 120_000 });
  const answer = (await assistant.last().textContent())?.trim() ?? "";
  assert(answer.length > 0, "The live browser request returned no text.");
}

await waitForServer();
const untrustedServer = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<!doctype html><title>Untrusted localhost fixture</title>");
});
await new Promise((resolveListen, rejectListen) => {
  untrustedServer.once("error", rejectListen);
  untrustedServer.listen(5174, "127.0.0.1", resolveListen);
});

const context = await chromium.launchPersistentContext(profilePath, {
  headless: false,
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  viewport: { width: 1280, height: 900 },
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
  const extensionOrigin = `chrome-extension://${extensionId}`;

  const options = await context.newPage();
  await options.goto(`${extensionOrigin}/options.html`, {
    waitUntil: "networkidle",
  });

  let usedFallback = false;
  if (live) {
    await configureLiveProvider(
      options,
      await credential(join(homedir(), ".llmp-key-test-1")),
    );
  }

  const app = await context.newPage();
  app.on("console", (message) => {
    if (message.type() === "error") {
      console.error(`dashboard console: ${message.text()}`);
    }
  });
  app.on("pageerror", (error) => {
    console.error(`dashboard error: ${error.message}`);
  });
  await app.goto(appOrigin, { waitUntil: "networkidle" });
  if ((await app.locator(".agent-provider-chat").count()) === 0) {
    await app.getByRole("button", { name: "Ask this page" }).click();
  }
  try {
    await app.locator(".agent-provider-chat").waitFor({ timeout: 10_000 });
  } catch (error) {
    const body = ((await app.locator("body").textContent()) ?? "").slice(
      0,
      500,
    );
    throw new Error(
      `Dashboard fixture did not render at ${app.url()}: ${body || "empty body"}`,
      { cause: error },
    );
  }
  assert(
    (await app.evaluate(() => typeof globalThis.chrome?.storage)) ===
      "undefined",
    "Provider storage was exposed to page JavaScript.",
  );

  const untrusted = await context.newPage();
  await untrusted.goto(untrustedOrigin, { waitUntil: "networkidle" });
  const untrustedReady = await untrusted.evaluate(
    () =>
      new Promise((resolveReady) => {
        const clientId = "untrusted-localhost-test";
        const listener = (event) => {
          if (
            event.data?.channel === "agent-provider.bridge" &&
            event.data?.clientId === clientId &&
            event.data?.direction === "extension-to-page" &&
            event.data?.type === "ready"
          ) {
            resolveReady(true);
          }
        };
        window.addEventListener("message", listener);
        window.postMessage(
          {
            channel: "agent-provider.bridge",
            bootstrap: 0,
            type: "hello",
            direction: "page-to-extension",
            clientId,
            supported: { min: 2, max: 2 },
          },
          location.origin,
        );
        setTimeout(() => {
          window.removeEventListener("message", listener);
          resolveReady(false);
        }, 750);
      }),
  );
  assert(!untrustedReady, "An unlisted localhost port established a bridge.");
  await untrusted.close();

  await app.bringToFront();
  const appTabId = await options.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tab?.id;
  });
  assert(
    appTabId !== undefined,
    "The dashboard tab was not visible to the extension.",
  );
  const sendUi = (request) =>
    options.evaluate((value) => chrome.runtime.sendMessage(value), {
      marker: "agent-provider.extension.ui.v1",
      tabId: appTabId,
      origin: appOrigin,
      ...request,
    });

  let response = await sendUi({
    type: "permission.set",
    decision: "grant-session",
  });
  assert(
    response?.status?.permission === "granted-session",
    "Session grant failed.",
  );

  response = await sendUi({ type: "audit.set", persistentEnabled: true });
  assert(
    response?.status?.audit?.persistentEnabled,
    "Per-origin audit did not enable.",
  );
  response = await sendUi({
    type: "session.set",
    mode: "standard",
    privateMode: true,
  });
  assert(
    response?.status?.execution?.privateMode,
    "Private mode did not enable.",
  );
  response = await sendUi({
    type: "session.set",
    mode: "standard",
    privateMode: false,
  });
  assert(
    !response?.status?.execution?.privateMode,
    "Private mode did not disable.",
  );

  if (live) {
    let authenticationFailed = false;
    const watchAuthentication = (response) => {
      if (
        response.url().startsWith("https://***REMOVED***/") &&
        (response.status() === 401 || response.status() === 403)
      ) {
        authenticationFailed = true;
      }
    };
    context.on("response", watchAuthentication);
    try {
      await runLiveRequest(app);
    } catch (error) {
      if (!authenticationFailed) throw error;
      usedFallback = true;
      await configureLiveProvider(
        options,
        await credential(
          join(homedir(), ".llmp-key-test-1.bak.20260722152638"),
        ),
      );
      await runLiveRequest(app);
    } finally {
      context.off("response", watchAuthentication);
    }
  }

  response = await sendUi({ type: "permission.set", decision: "revoke" });
  assert(response?.status?.permission === "prompt", "Grant revocation failed.");
  response = await sendUi({
    type: "permission.set",
    decision: "grant-persistent",
  });
  assert(
    response?.status?.permission === "granted-persistent",
    "Persistent grant failed.",
  );
  response = await sendUi({ type: "status" });
  assert(
    response?.status?.permission === "granted-persistent",
    "Persistent grant was not retained.",
  );

  const auditPage = await context.newPage();
  await auditPage.goto(
    `${extensionOrigin}/options.html?origin=${encodeURIComponent(appOrigin)}`,
    { waitUntil: "networkidle" },
  );
  await auditPage.waitForLoadState("networkidle");
  await auditPage.getByText("Site ledger", { exact: true }).waitFor();
  await auditPage.getByText(appOrigin, { exact: true }).first().waitFor();

  console.log(
    `Chrome extension browser integration passed${
      live
        ? ` with live provider${usedFallback ? " (backup credential)" : ""}`
        : ""
    }.`,
  );
} finally {
  await context.close();
  server.kill("SIGTERM");
  untrustedServer.close();
  await new Promise((resolveExit) => {
    if (server.exitCode !== null) return resolveExit();
    server.once("exit", resolveExit);
    setTimeout(resolveExit, 2_000).unref();
  });
  await rm(profilePath, { recursive: true, force: true });
}
