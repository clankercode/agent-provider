# Promoted source inventory

## Authorization

Max Kaye, the repository owner and authorizing rightsholder, confirmed in the
2026-07-23 implementation session that he owns the Sitehand copyright and
authorizes the owner-authored Sitehand material to be relicensed and promoted
into Agent Provider under `CC0-1.0 OR Unlicense`. The prior MIT file was a
default distribution choice and is not Agent Provider's selected license.

## Source snapshot

- Source root: `draft-designs/unpacked/sitehand/sitehand/`
- Containing Agent Provider commit at authorization: `65a427a69cdacd7614b34763da0da701ab190859`
- Selected-corpus hash: `sha256:84aa05d8aa664cd3136bd72a50b9680bb9378f8f43822ddc4120a9af910a768e`
- Hash construction: lexically sort every regular file beneath
  `packages/` and `apps/extension/`, excluding `.output/`, `LICENSE`, and
  `README.md`; hash each file with SHA-256; hash the resulting manifest.

## Intended promotion

- `packages/protocol/src/` becomes `packages/protocol/src/`.
- `packages/provider/src/` becomes the initial `packages/ai-sdk/src/` bridge.
- `packages/core/src/` becomes the initial `packages/runtime/src/`, except that
  WebMCP moves to its own package.
- `packages/react/src/` becomes the initial `packages/react/src/`.
- `apps/extension/entrypoints/` and `apps/extension/lib/` become the initial
  extension implementation.

Package manifests and TypeScript/WXT configuration are used as build-system
inputs but are rewritten for Agent Provider. Generated archives, `.output/`,
old package license files, old READMEs, and Sitehand public compatibility names
are not promoted.

Third-party dependencies retain their own licenses. If a future audit finds an
independently authored portion not covered by this authorization, that portion
must retain its terms or be replaced before release.
