# Release process

Releases are automated by CI. Pushing a `vX.Y.Z` tag triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml), which:

1. re-runs the full gate (`npm run check`: format, typecheck, unit tests,
   build, packed-package tests);
2. verifies the tag matches every version-locked manifest — the root
   package.json, the six publishable packages, and `apps/extension` (whose
   version wxt bakes into the store artifacts) — plus the pinned
   `@agent-provider/*` inter-dependencies (`scripts/verify-release-version.mjs`);
3. publishes the six `@agent-provider/*` packages to npm in dependency order
   (`protocol`, `context` → `ai-sdk` → `runtime` → `react`, `webmcp`) via
   **OIDC trusted publishing** — no `NPM_TOKEN` secret, and build provenance
   is attached automatically (each package sets `publishConfig.provenance`);
4. builds the store artifacts (`npm run package:stores`) and creates a GitHub
   Release with the Chrome/Firefox zips and `SHA256SUMS` attached.

Already-published versions are skipped, so a failed release run can be fixed
and re-tagged (or the workflow re-run) without manual unpicking.

Every push to `master` and every PR also runs the gate via
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Cutting a release

From a clean `master`:

```bash
just release 0.2.0                # runs the gate, then the steps below
# or directly:
npm run release -- 0.2.0          # explicit version
# or: npm run release -- patch | minor | major
```

This bumps the version-locked manifests (root, the six publishable packages,
and `apps/extension`), re-pins the `@agent-provider/*` dependencies across all
workspaces, syncs `package-lock.json`, commits `chore: release vX.Y.Z`, and
tags `vX.Y.Z`. It refuses to run on a dirty tree, off `master`, or when
`master` differs from its upstream. Then:

`just release` runs the full gate first, then bumps, commits, tags, and
pushes in one go. The npm variant only bumps, commits, and tags — either way,
the manual step is:

```bash
git push origin master v0.2.0     # the tag push is what publishes
```

Watch the run in the repo's **Actions** tab.

## One-time setup: npm trusted publishers

Trusted publishing must be configured once **per package** so the registry
trusts this repo's release workflow (no token needed). For each of
`@agent-provider/protocol`, `context`, `ai-sdk`, `runtime`, `react`, `webmcp`:

1. Open `https://www.npmjs.com/package/@agent-provider/<name>/access`
   (Settings → Publishing access → Trusted Publishing).
2. Add a **GitHub Actions** publisher:
   - Organization/user: `clankercode`
   - Repository: `agent-provider`
   - Workflow filename: `release.yml`
   - Environment: _(leave blank)_

npm only shows the trusted-publisher form for packages that already exist on
the registry, so the **first** release of each package is published manually:

```bash
npm login                           # one-time, on your machine
npm run check                       # make sure the gate passes
npm run build:packages
for pkg in protocol context ai-sdk runtime react webmcp; do
  npm publish -w "@agent-provider/$pkg" --no-provenance --otp=<2FA code>
done
```

Two local-publish gotchas, both shown above:

- `--no-provenance` is required: each package sets
  `publishConfig.provenance: true`, which only works inside GitHub Actions
  (OIDC). Local publishes fail with `EUSAGE: Automatic provenance generation
not supported` without the flag. The CI workflow does not need it.
- `--otp` is required if your npm account has 2FA for writes (recommended).
  Without it npm fails with `EOTP`.

After the initial publish, configure the trusted publishers as above; every
later `vX.Y.Z` tag then publishes automatically.

## Notes

- The tag name must equal the bumped version (`v0.2.0` ↔ `0.2.0`); CI fails
  the release if they disagree.
- The six packages are version-locked: they share one version, and their
  `@agent-provider/*` dependencies are pinned exactly, so dependencies must
  reach the registry before dependents — the publish loop runs in dependency
  order for this reason.
- If a publish fails partway, fix the cause, re-run the failed workflow (or
  push a new tag after `npm run release -- patch`); published versions are
  skipped on retry. A tag pushed before all six trusted publishers are
  configured fails partway through the loop in exactly this recoverable way.
- Provenance via trusted publishing only works while the GitHub repository is
  **public**; on a private repo the OIDC publish fails. The `repository.url`
  in each package.json must also match the GitHub repo exactly (it is
  case-sensitive) or npm rejects the publish with E422.
- npm cannot unpublish or overwrite a version — if a bad version ships, bump
  and release again rather than trying to recycle the version number.
