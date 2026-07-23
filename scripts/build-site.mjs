// Build the GitHub Pages site into _site/.
//
// Renders store/PRIVACY.md through GitHub's markdown API (same rendering as
// the repo's markdown view) and wraps it in a minimal styled page. Run via
// `npm run build:site`; .github/workflows/pages.yml runs it on every push
// that touches the inputs and deploys _site/ to Pages.

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outDir = resolve(root, "_site");

const REPO = "https://github.com/clankercode/agent-provider";

const STYLE = `
  :root { color-scheme: light dark; }
  body {
    font-family: ui-sans-serif, system-ui, sans-serif;
    line-height: 1.6;
    max-width: 46rem;
    margin: 0 auto;
    padding: 3rem 1.25rem;
  }
  nav { font-size: 0.9rem; margin-bottom: 2rem; }
  nav a { color: #4f46e5; text-decoration: none; margin-right: 1rem; }
  h1 { line-height: 1.2; }
  footer { margin-top: 3rem; font-size: 0.85rem; opacity: 0.7; }
`;

function shell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Agent Provider</title>
<style>${STYLE}</style>
</head>
<body>
<nav>
  <a href="${REPO}">GitHub</a>
  <a href="./privacy/">Privacy policy</a>
</nav>
${body}
<footer>Agent Provider — CC0-1.0 OR Unlicense.</footer>
</body>
</html>
`;
}

const privacyHtml = execFileSync(
  "gh",
  ["api", "markdown", "-F", "text=@store/PRIVACY.md", "-F", "mode=gfm"],
  { cwd: root, encoding: "utf8", env: { ...process.env } },
);

const indexBody = `<h1>Agent Provider</h1>
<p>Browser-mediated, user-controlled model access for trusted web
applications. Source, releases, and documentation live on
<a href="${REPO}">GitHub</a>.</p>
<ul>
  <li><a href="./privacy/">Privacy policy</a></li>
  <li><a href="${REPO}/releases">Releases</a></li>
</ul>`;

await mkdir(join(outDir, "privacy"), { recursive: true });
await writeFile(join(outDir, "index.html"), shell("Home", indexBody));
await writeFile(
  join(outDir, "privacy", "index.html"),
  shell("Privacy policy", privacyHtml),
);

console.log(`Built site in ${outDir}`);
