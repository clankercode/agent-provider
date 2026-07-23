# Store release checklist

Create reviewed upload artifacts from a clean commit:

```bash
npm ci
npm run check
npm run test:browser
npm run test:firefox
npm run package:stores
```

`release/` then contains Chrome and Firefox upload ZIPs, a full Git source ZIP
for Firefox review, and SHA-256 checksums. The package script rejects a dirty
tracked worktree and verifies that each browser ZIP has a root manifest and no
obvious secret/build-source paths.

Before submission, the publisher must:

1. use the privacy policy URL — `PRIVACY.md` is published via GitHub Pages
   (`.github/workflows/pages.yml`) at
   https://clankercode.github.io/agent-provider/privacy/ — and replace its
   temporary contact paragraph;
2. confirm support URL, publisher identity, category, and listing screenshots;
3. complete Chrome Web Store and AMO data-use declarations from
   `PRIVACY.md` and `PERMISSIONS.md`;
4. upload the Chrome ZIP to Chrome Web Store;
5. upload the Firefox ZIP and full source ZIP to AMO; and
6. retain `SHA256SUMS` with the release record.

Signing, account enrollment, fees, declarations, and final store submission are
external publisher actions and are not performed by this repository script.
