// Bump the monorepo version, commit, and tag a release.
//
//   node scripts/release.mjs 0.2.0          # explicit version
//   node scripts/release.mjs patch|minor|major
//   node scripts/release.mjs 0.2.0 --dry-run
//
// Version-locks the root package.json, every publishable package, and
// apps/extension (its version names the store artifacts); re-pins
// @agent-provider/* dependencies across ALL workspaces (examples pin them
// too); then syncs package-lock.json, commits "chore: release vX.Y.Z", and
// creates an annotated vX.Y.Z tag. Pushing is left to the operator — the tag
// push is what publishes (see RELEASE.md).

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");
const spec = process.argv.slice(2).find((a) => !a.startsWith("--"));

const SEMVER = /^\d+\.\d+\.\d+$/;
const PARTS = ["patch", "minor", "major"];

if (!spec || (!SEMVER.test(spec) && !PARTS.includes(spec))) {
  console.error(
    "usage: node scripts/release.mjs <X.Y.Z|patch|minor|major> [--dry-run]",
  );
  process.exit(1);
}

const rootManifestPath = join(root, "package.json");
const rootManifest = JSON.parse(await readFile(rootManifestPath, "utf8"));
const current = rootManifest.version;

function bump(version, part) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (part === "major") return `${major + 1}.0.0`;
  if (part === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const next = SEMVER.test(spec) ? spec : bump(current, spec);
if (next === current) {
  console.error(`error: version is already ${current}`);
  process.exit(1);
}

const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

if (!dryRun) {
  if (git("status", "--porcelain", "--untracked-files=no").length > 0) {
    console.error("error: commit tracked changes before releasing.");
    process.exit(1);
  }
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "master") {
    console.error(`error: release from master, not "${branch}".`);
    process.exit(1);
  }
  // If the branch has an upstream, refuse to tag unreconciled work. This is
  // a local comparison only (no fetch): stale-ahead/behind states surface at
  // push time with a clear git error.
  try {
    const upstream = git("rev-parse", "@{upstream}");
    if (upstream !== git("rev-parse", "HEAD")) {
      console.error(
        "error: master differs from its upstream; push or pull first.",
      );
      process.exit(1);
    }
  } catch {
    // No upstream configured — nothing to compare against.
  }
}

const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies"];

// Expand the root "workspaces" globs (only simple "<dir>/*" patterns used
// here) to workspace package.json paths, skipping directories without one.
const workspaceManifests = [];
for (const pattern of rootManifest.workspaces ?? []) {
  const m = /^([^*]+)\/\*$/.exec(pattern);
  if (!m) throw new Error(`unsupported workspaces pattern: ${pattern}`);
  for (const d of readdirSync(join(root, m[1]), { withFileTypes: true })) {
    const rel = join(m[1], d.name, "package.json");
    if (d.isDirectory() && existsSync(join(root, rel)))
      workspaceManifests.push(rel);
  }
}

// Stage every edit in memory first so a malformed manifest cannot leave a
// half-bumped tree.
const staged = [];
const bumped = [];
for (const rel of ["package.json", ...workspaceManifests]) {
  const m = JSON.parse(await readFile(join(root, rel), "utf8"));
  // The root manifest is private but its version names the store artifacts,
  // and apps/extension's version is what wxt bakes into the store zips — both
  // are version-locked. Other private workspaces (examples) keep their own
  // versions and only get their @agent-provider/* pins updated.
  if (
    !m.private ||
    rel === "package.json" ||
    rel === join("apps", "extension", "package.json")
  ) {
    m.version = next;
    bumped.push(rel);
  }
  for (const field of DEP_FIELDS) {
    for (const dep of Object.keys(m[field] ?? {})) {
      if (dep.startsWith("@agent-provider/")) m[field][dep] = next;
    }
  }
  staged.push([rel, JSON.stringify(m, null, 2) + "\n"]);
}

console.log(`${current} -> ${next}`);
for (const rel of bumped) {
  console.log(`  bumped ${rel}`);
}
for (const [rel] of staged) {
  if (!bumped.includes(rel)) console.log(`  re-pinned deps in ${rel}`);
}

if (dryRun) {
  console.log("dry run: no files written, no commit, no tag");
  process.exit(0);
}

for (const [rel, text] of staged) {
  await writeFile(join(root, rel), text);
}

// Sync workspace versions and inter-dep pins into the lockfile.
execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(
  "git",
  ["add", "package.json", "package-lock.json", ...workspaceManifests],
  { cwd: root, stdio: "inherit" },
);
execFileSync("git", ["commit", "-m", `chore: release v${next}`], {
  cwd: root,
  stdio: "inherit",
});
execFileSync("git", ["tag", "-a", `v${next}`, "-m", `v${next}`], {
  cwd: root,
  stdio: "inherit",
});

console.log(`
Tagged v${next}. To publish:
  git push origin master v${next}
The tag push triggers .github/workflows/release.yml (see RELEASE.md).`);
