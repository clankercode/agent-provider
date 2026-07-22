import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const release = join(root, "release");
const extensionOutput = join(root, "apps/extension/.output");
const { version } = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);

const dirty = execFileSync(
  "git",
  ["status", "--porcelain", "--untracked-files=no"],
  { cwd: root, encoding: "utf8" },
).trim();
if (dirty.length > 0) {
  throw new Error("Commit tracked changes before packaging store artifacts.");
}

execFileSync("npm", ["run", "zip", "-w", "agent-provider-extension"], {
  cwd: root,
  stdio: "inherit",
});
execFileSync("npm", ["run", "zip:firefox", "-w", "agent-provider-extension"], {
  cwd: root,
  stdio: "inherit",
});

await mkdir(release, { recursive: true });
const artifacts = [
  {
    source: join(
      extensionOutput,
      `agent-provider-extension-${version}-chrome.zip`,
    ),
    target: join(release, `agent-provider-${version}-chrome.zip`),
  },
  {
    source: join(
      extensionOutput,
      `agent-provider-extension-${version}-firefox.zip`,
    ),
    target: join(release, `agent-provider-${version}-firefox.zip`),
  },
];
for (const artifact of artifacts)
  await copyFile(artifact.source, artifact.target);

const sourceArchive = join(release, `agent-provider-${version}-source.zip`);
execFileSync(
  "git",
  [
    "archive",
    "--format=zip",
    `--prefix=agent-provider-${version}/`,
    `--output=${sourceArchive}`,
    "HEAD",
  ],
  { cwd: root },
);
artifacts.push({ source: sourceArchive, target: sourceArchive });

for (const artifact of artifacts.slice(0, 2)) {
  const entries = execFileSync("unzip", ["-Z1", artifact.target], {
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  if (!entries.includes("manifest.json")) {
    throw new Error(`${basename(artifact.target)} has no root manifest.json.`);
  }
  if (
    entries.some((entry) =>
      /(^|\/)(node_modules|\.git|\.env|.*(?:key|secret).*)(\/|$)/iu.test(entry),
    )
  ) {
    throw new Error(`${basename(artifact.target)} contains a forbidden path.`);
  }
}

const checksumLines = [];
for (const { target } of artifacts) {
  const digest = createHash("sha256")
    .update(await readFile(target))
    .digest("hex");
  checksumLines.push(`${digest}  ${basename(target)}`);
}
await writeFile(join(release, "SHA256SUMS"), `${checksumLines.join("\n")}\n`);

console.log(`Store artifacts written to ${release}`);
