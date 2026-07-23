# agent-provider — common tasks
# (repo norm: a justfile manages common scripts; everything here wraps the
# npm scripts in package.json, which remain the source of truth)

# Install deps.
install:
    npm install

# Build everything: packages, extension (Chrome + Firefox), example app.
build:
    npm run build

# Build only the six publishable packages (dependency order).
build-packages:
    npm run build:packages

# Build the browser extension (Chrome MV3).
build-extension:
    npm run build:extension

# Format all files with prettier.
format:
    npm run format

# Check formatting without writing.
format-check:
    npm run format:check

# Typecheck all workspaces (builds packages first for cross-package types).
typecheck:
    npm run typecheck

# Run unit tests across workspaces.
test:
    npm test

# Pack the packages and verify they load as published tarballs.
test-packages:
    npm run test:packages

# Chrome extension smoke test (needs Chrome/Chromium; use xvfb-run headless).
test-browser:
    npm run test:browser

# Firefox extension lint + smoke test (needs Firefox + geckodriver).
test-firefox:
    npm run test:firefox

# Live model tests against a real extension session (needs credentials).
test-live:
    npm run test:live

# Full CI gate: format, typecheck, unit tests, build, packed-package tests.
# Matches what .github/workflows/ci.yml and release.yml run (minus the
# browser smoke tests, which CI runs separately).
check:
    npm run check

# Start the extension in dev/watch mode.
dev-extension:
    npm run dev:extension

# Start the operations-dashboard example app.
dev-example:
    npm run dev:example

# Build store zips + SHA256SUMS into release/ (requires a clean worktree).
package-stores:
    npm run package:stores

# Cut a release: gate, bump all version-locked manifests, re-pin
# @agent-provider/* deps, sync the lockfile, commit, tag, and push.
# Pushing the vX.Y.Z tag triggers .github/workflows/release.yml, which
# re-runs the gate, publishes the six packages to npm (OIDC trusted
# publishing), and creates the GitHub Release. VERSION is an explicit semver
# (e.g. 0.2.0) or patch | minor | major. master must be pushed and in sync
# with origin before running this — see RELEASE.md.
release VERSION: check
    node scripts/release.mjs "{{VERSION}}"
    git push origin master "v$(node -p "require('./package.json').version")"
    @echo "Pushed v$(node -p "require('./package.json').version") — CI will publish to npm and create the GitHub Release."

# Verify a version is consistent across all version-locked manifests and
# @agent-provider/* pins (the release workflow runs this against its tag).
verify-release VERSION:
    node scripts/verify-release-version.mjs "{{VERSION}}"
