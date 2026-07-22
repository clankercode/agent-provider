import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageNames = [
  "protocol",
  "context",
  "ai-sdk",
  "runtime",
  "react",
  "webmcp",
];
const workspace = await mkdtemp(join(tmpdir(), "agent-provider-pack-"));

function run(command, args, cwd = repository) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

try {
  const tarballs = [];
  for (const packageName of packageNames) {
    const directory = join(repository, "packages", packageName);
    const raw = run(
      "npm",
      ["pack", "--json", "--pack-destination", workspace],
      directory,
    );
    const parsed = JSON.parse(raw);
    const packed = Array.isArray(parsed)
      ? parsed[0]
      : parsed[`@agent-provider/${packageName}`];
    assert.ok(packed, `npm pack did not report ${packageName}`);
    const paths = new Set(packed.files.map((file) => file.path));
    for (const required of [
      "package.json",
      "README.md",
      "LICENSE",
      "LICENSE-CC0",
      "UNLICENSE",
      "dist/index.js",
      "dist/index.d.ts",
    ]) {
      assert.ok(paths.has(required), `${packageName} omitted ${required}`);
    }
    tarballs.push(join(workspace, packed.filename));
  }

  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify({
      name: "agent-provider-packed-consumer",
      private: true,
      type: "module",
    }),
  );
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      ...tarballs,
      "react@19.2.7",
      "react-dom@19.2.7",
      "zod@4.4.3",
      "@types/json-schema@7.0.15",
      "@types/node@24.10.14",
      "@types/react@19.2.14",
      "@types/react-dom@19.2.3",
    ],
    workspace,
  );

  const smoke = `
    import assert from "node:assert/strict";
    import * as protocol from "@agent-provider/protocol";
    import * as context from "@agent-provider/context";
    import * as aiSdk from "@agent-provider/ai-sdk";
    import * as runtime from "@agent-provider/runtime";
    import * as react from "@agent-provider/react";
    import * as webmcp from "@agent-provider/webmcp";
    assert.equal(typeof protocol.createBridgeEnvelope, "function");
    assert.equal(typeof context.createPageContext, "function");
    assert.equal(typeof aiSdk.createAgentProviderModel, "function");
    assert.equal(typeof runtime.AgentProviderRuntime, "function");
    assert.equal(typeof react.AgentProviderProvider, "function");
    assert.equal(typeof webmcp.mirrorToolsToWebMcp, "function");
    const css = new URL(import.meta.resolve("@agent-provider/react/styles.css"));
    assert.match(await (await import("node:fs/promises")).readFile(css, "utf8"), /agent-provider/);
  `;
  await writeFile(join(workspace, "smoke.mjs"), smoke);
  run("node", ["smoke.mjs"], workspace);

  const typeSmoke = `
    import type { BridgeCapabilities } from "@agent-provider/protocol";
    import type { PageContext } from "@agent-provider/context";
    import type { AgentProviderLanguageModel } from "@agent-provider/ai-sdk";
    import type { AgentProviderRuntime } from "@agent-provider/runtime";
    import type { AgentProviderProviderProps } from "@agent-provider/react";
    import type { WebMcpMirrorHandle } from "@agent-provider/webmcp";
    export type PackedTypes = [
      BridgeCapabilities,
      PageContext,
      AgentProviderLanguageModel,
      AgentProviderRuntime,
      AgentProviderProviderProps,
      WebMcpMirrorHandle,
    ];
  `;
  await writeFile(join(workspace, "smoke.ts"), typeSmoke);
  await writeFile(
    join(workspace, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        types: ["node"],
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      include: ["smoke.ts"],
    }),
  );
  run(
    join(repository, "node_modules", ".bin", "tsc"),
    ["-p", "tsconfig.json"],
    workspace,
  );

  const packageJson = JSON.parse(
    await readFile(
      join(
        workspace,
        "node_modules",
        "@agent-provider",
        "runtime",
        "package.json",
      ),
      "utf8",
    ),
  );
  assert.equal(packageJson.publishConfig.access, "public");
  console.log(
    `Packed consumer smoke passed for ${packageNames.length} packages.`,
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}
