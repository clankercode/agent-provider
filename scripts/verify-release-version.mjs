// Verify that a release tag version is consistent across the monorepo:
// the version-locked manifests (root, publishable packages, apps/extension)
// and the pinned @agent-provider/* dependencies in ALL workspaces (examples
// pin them too). Used by .github/workflows/release.yml; exits non-zero on any
// mismatch.

import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tag = process.argv[2];

if (!tag || !/^\d+\.\d+\.\d+$/.test(tag)) {
  console.error(`error: expected a bare X.Y.Z version, got "${tag}"`);
  process.exit(1);
}

const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies"];

const rootManifest = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const manifests = ["package.json"];
for (const pattern of rootManifest.workspaces ?? []) {
  const m = /^([^*]+)\/\*$/.exec(pattern);
  if (!m) throw new Error(`unsupported workspaces pattern: ${pattern}`);
  for (const d of readdirSync(join(root, m[1]), { withFileTypes: true })) {
    const rel = join(m[1], d.name, "package.json");
    if (d.isDirectory() && existsSync(join(root, rel))) manifests.push(rel);
  }
}

const failures = [];
for (const rel of manifests) {
  const m = JSON.parse(await readFile(join(root, rel), "utf8"));
  // The root manifest and apps/extension are private but version-locked: the
  // root version names the store artifacts, and the extension version is what
  // wxt bakes into them. Other private workspaces keep their own versions.
  const versionLocked =
    !m.private ||
    rel === "package.json" ||
    rel === join("apps", "extension", "package.json");
  if (versionLocked && m.version !== tag) {
    failures.push(`${rel}: version ${m.version} != tag ${tag}`);
  }
  for (const field of DEP_FIELDS) {
    for (const [dep, range] of Object.entries(m[field] ?? {})) {
      if (dep.startsWith("@agent-provider/") && range !== tag) {
        failures.push(
          `${rel}: ${field}.${dep} pinned to ${range} != tag ${tag}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error("release version mismatch:");
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`tag ${tag} matches all version-locked manifests and pins`);
