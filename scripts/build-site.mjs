// Build the GitHub Pages site into _site/.
//
// - index.html: project landing page (hero, features, screenshot gallery,
//   package table). Screenshots are copied from store/screenshots/ — the
//   gallery includes whichever of the preferred shots exist.
// - privacy/index.html: store/PRIVACY.md rendered through GitHub's markdown
//   API (same rendering as the repo's markdown view).
//
// Run via `npm run build:site`; .github/workflows/pages.yml runs it on every
// push that touches the inputs and deploys _site/ to Pages.

import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outDir = resolve(root, "_site");

const REPO = "https://github.com/clankercode/agent-provider";

// Visual identity matches the extension UI: warm paper background, ink navy
// text, serif display headings, indigo actions, small-caps labels.
const STYLE = `
  :root {
    --paper: #f7f3ec;
    --card: #fffdf8;
    --ink: #1b2334;
    --muted: #5d6472;
    --accent: #2f4fb3;
    --accent-soft: #e6ebf9;
    --line: #e3dccb;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    line-height: 1.6;
  }
  .wrap { max-width: 62rem; margin: 0 auto; padding: 0 1.5rem; }
  h1, h2, h3 { font-family: Georgia, "Iowan Old Style", "Times New Roman", serif; line-height: 1.15; }
  a { color: var(--accent); }

  nav {
    display: flex; align-items: center; gap: 0.75rem;
    padding: 1.25rem 0; font-size: 0.95rem;
  }
  nav .brand { display: flex; align-items: center; gap: 0.6rem; font-weight: 650; color: var(--ink); text-decoration: none; }
  nav .brand .mark {
    width: 1.75rem; height: 1.75rem; border-radius: 0.5rem;
    background: var(--ink); color: var(--paper);
    display: grid; place-items: center;
    font-size: 0.7rem; font-weight: 700; letter-spacing: 0.02em;
  }
  nav .spacer { flex: 1; }
  nav a { text-decoration: none; }
  nav a:hover { text-decoration: underline; }

  .label {
    font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--muted); font-weight: 650; margin: 0 0 0.75rem;
  }
  .hero { padding: 4.5rem 0 3rem; }
  .hero h1 { font-size: clamp(2.4rem, 5.5vw, 3.6rem); margin: 0 0 1rem; }
  .hero p.lede { font-size: 1.15rem; color: var(--muted); max-width: 40rem; margin: 0 0 2rem; }
  .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; }
  .btn {
    display: inline-block; padding: 0.7rem 1.3rem; border-radius: 0.6rem;
    font-weight: 600; text-decoration: none; font-size: 0.95rem;
  }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover { background: #274192; }
  .btn-ghost { background: var(--card); color: var(--ink); border: 1px solid var(--line); }
  .btn-ghost:hover { border-color: var(--accent); }

  section { padding: 2.5rem 0; }
  .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
  .card {
    background: var(--card); border: 1px solid var(--line);
    border-radius: 0.9rem; padding: 1.25rem 1.4rem;
  }
  .card h3 { margin: 0 0 0.4rem; font-size: 1.1rem; }
  .card p { margin: 0; color: var(--muted); font-size: 0.95rem; }

  .shots { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); }
  .shots figure { margin: 0; }
  .shots img {
    width: 100%; border-radius: 0.75rem; border: 1px solid var(--line);
    box-shadow: 0 18px 40px -18px rgba(27, 35, 52, 0.35);
  }
  .shots figcaption { font-size: 0.85rem; color: var(--muted); margin-top: 0.5rem; }

  table.pkgs { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 0.9rem; overflow: hidden; }
  table.pkgs td { padding: 0.7rem 1rem; border-top: 1px solid var(--line); font-size: 0.95rem; }
  table.pkgs tr:first-child td { border-top: none; }
  table.pkgs code { background: var(--accent-soft); padding: 0.1rem 0.4rem; border-radius: 0.35rem; font-size: 0.85rem; }
  table.pkgs td:last-child { color: var(--muted); }

  .install {
    background: var(--ink); color: var(--paper); border-radius: 0.75rem;
    padding: 1rem 1.25rem; font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.9rem; overflow-x: auto;
  }

  footer {
    margin-top: 3rem; padding: 2rem 0 3rem; border-top: 1px solid var(--line);
    font-size: 0.85rem; color: var(--muted);
  }

  /* Privacy policy page keeps the same shell but plain reading width. */
  body.doc .wrap { max-width: 46rem; }
`;

const SCREENSHOTS = [
  ["popup.png", "Per-origin control from the toolbar popup."],
  ["approval.png", "Exact-origin consent, scoped to a tab or a site."],
  ["chat.png", "A trusted app using your model, mid-conversation."],
  ["dashboard.png", "The operations dashboard example app."],
  ["options.png", "Provider profiles — credentials stay in the extension."],
  ["options-dark.png", "Dark mode throughout."],
];

const PACKAGES = [
  [
    "@agent-provider/ai-sdk",
    "AI SDK LanguageModel provider over the extension bridge.",
  ],
  [
    "@agent-provider/runtime",
    "Headless runtime: typed tools, run state, approvals.",
  ],
  ["@agent-provider/react", "React bindings and a reference chat surface."],
  ["@agent-provider/context", "Bounded, revisioned page context extraction."],
  ["@agent-provider/protocol", "Versioned wire protocol and safe-value codec."],
  ["@agent-provider/webmcp", "Mirror eligible tools into the WebMCP API."],
];

function shell(title, body, { doc = false } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Agent Provider</title>
<meta name="description" content="Browser-mediated, user-controlled model access for trusted web applications.">
<style>${STYLE}</style>
</head>
<body${doc ? ' class="doc"' : ""}>
<div class="wrap">
<nav>
  <a class="brand" href="./"><span class="mark">AP</span>Agent Provider</a>
  <span class="spacer"></span>
  <a href="${REPO}">GitHub</a>
  <a href="${REPO}/releases">Releases</a>
  <a href="./privacy/">Privacy</a>
</nav>
${body}
<footer>Agent Provider — CC0-1.0 OR Unlicense.</footer>
</div>
</body>
</html>
`;
}

// --- Screenshots: copy what exists, in preferred order. ---
const shotsDir = resolve(root, "store", "screenshots");
const present = new Set(await readdir(shotsDir).catch(() => []));
await mkdir(join(outDir, "screenshots"), { recursive: true });
const gallery = [];
for (const [file, caption] of SCREENSHOTS) {
  if (!present.has(file)) continue;
  await copyFile(join(shotsDir, file), join(outDir, "screenshots", file));
  gallery.push(
    `<figure><img src="./screenshots/${file}" alt="${caption}" loading="lazy"><figcaption>${caption}</figcaption></figure>`,
  );
}

const indexBody = `<header class="hero">
  <p class="label">Browser extension + npm packages</p>
  <h1>Your model account.<br>Your rules. Their tools.</h1>
  <p class="lede">Agent Provider lets trusted web applications use an AI
  provider account you control — without your credential ever touching page
  JavaScript. Exact-origin consent, typed tools with approval, quotas, and
  private audit controls, all mediated by the extension.</p>
  <div class="actions">
    <a class="btn btn-primary" href="${REPO}">View on GitHub</a>
    <a class="btn btn-ghost" href="${REPO}/releases">Download the extension</a>
  </div>
</header>

<section>
  <p class="label">What you keep control of</p>
  <div class="grid">
    <div class="card"><h3>Credentials stay put</h3><p>API keys live in extension storage and are never exposed to page code. Pages select a model alias; the extension brokers the call.</p></div>
    <div class="card"><h3>Exact-origin consent</h3><p>Grant a single tab or an entire origin, session-only or persistent. Revocable at any time from settings.</p></div>
    <div class="card"><h3>Typed, approved tools</h3><p>Apps declare tools with risk levels. Write and destructive actions need your explicit approval — independently of the page.</p></div>
    <div class="card"><h3>Quotas and audit</h3><p>Durable per-origin quotas, standard/audit-first/private execution modes, and metadata-only audit records you can inspect and delete.</p></div>
  </div>
</section>

<section>
  <p class="label">See it</p>
  <div class="shots">
    ${gallery.join("\n    ")}
  </div>
</section>

<section>
  <p class="label">Build on it</p>
  <div class="install">npm install @agent-provider/ai-sdk ai</div>
  <table class="pkgs">
    ${PACKAGES.map(
      ([name, desc]) =>
        `<tr><td><code>${name}</code></td><td>${desc}</td></tr>`,
    ).join("\n    ")}
  </table>
</section>`;

// --- Privacy policy via GitHub's markdown renderer. ---
const privacyHtml = execFileSync(
  "gh",
  ["api", "markdown", "-F", "text=@store/PRIVACY.md", "-F", "mode=gfm"],
  { cwd: root, encoding: "utf8", env: { ...process.env } },
);

await mkdir(join(outDir, "privacy"), { recursive: true });
await writeFile(join(outDir, "index.html"), shell("Home", indexBody));
await writeFile(
  join(outDir, "privacy", "index.html"),
  shell("Privacy policy", privacyHtml, { doc: true }),
);

console.log(`Built site in ${outDir} (${gallery.length} screenshots)`);
