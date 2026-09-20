const fs = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const landingPath = path.join(repoRoot, 'docs', 'landing.md');
const outputPath = path.join(repoRoot, 'docs', 'index.html');

// The markdown pipeline and the frontmatter helpers are the compiled shared
// engine (src/markdownCore.ts → dist/markdownCore.js) — the same module the
// extension bundles — so the landing page can never drift away from preview
// rendering again. The artifact is a build output: `npm run compile` first.
let sharedCore;
try {
  sharedCore = require(path.join(repoRoot, 'dist', 'markdownCore.js'));
} catch (err) {
  // Only translate the "artifact not built" failure — a present-but-broken
  // bundle (or missing node_modules) rethrows its own, more accurate error.
  const missingArtifact =
    err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes('markdownCore');
  if (missingArtifact) {
    throw new Error(
      'dist/markdownCore.js not found — run `npm run compile` before `npm run build:landing`'
    );
  }
  throw err;
}
const { createMarkdownIt, parseFrontmatter, renderFrontmatterHtml, escapeHtml, detectVendorNeeds } =
  sharedCore;

// Generated assets the page links instead of inlining (issue #78): vendor
// runtimes, the client-side render script, and the JSON-LD mirror. Emitted
// under docs/ next to index.html so the Pages workflow deploys them together;
// the directory is gitignored and rebuilt from scratch on every run.
const assetsDir = path.join(repoRoot, 'docs', 'assets');

// Mirrors the flags the extension renders the preview with (PreviewConfig):
// typographer on, hard line breaks off, every renderer feature on.
const LANDING_CONFIG = {
  typographer: true,
  lineBreaks: false,
  enableMermaid: true,
  enableExcalidraw: true,
  enableCheckboxes: true,
  enableKatex: true,
};

function createLandingRenderer() {
  return createMarkdownIt(LANDING_CONFIG, {
    // Landing-only decoration: markdown images get a styled class; srcs stay
    // untouched here because embedImages() rewrites them to data URIs later.
    decorateImageToken: (token) => token.attrJoin('class', 'preview-image'),
  });
}

function resolveImageUri(src, documentPath) {
  if (src.startsWith('data:') || /^https?:\/\//.test(src)) {
    return src;
  }
  if (src.startsWith('file:')) {
    return decodeURIComponent(src.replace(/^file:\/\//, ''));
  }
  if (path.isAbsolute(src)) {
    return src;
  }
  return path.resolve(path.dirname(documentPath), src);
}

function getImageMimeType(ext) {
  return (
    {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.ico': 'image/x-icon',
    }[ext.toLowerCase()] || 'application/octet-stream'
  );
}

async function embedImages(html, documentPath) {
  const imgRegex = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/g;
  const matches = [...html.matchAll(imgRegex)];

  // Resolve each matched tag's image to a data URI first, keyed by the tag's
  // offset in the document. The src string alone is not a safe String.replace
  // needle: it can repeat across tags or appear in prose, and the first
  // textual occurrence is not necessarily the tag that produced it.
  const dataUriByOffset = new Map();
  for (const match of matches) {
    const originalSrc = match[1];
    if (originalSrc.startsWith('data:') || /^https?:\/\//.test(originalSrc)) continue;

    const filePath = resolveImageUri(originalSrc, documentPath);
    try {
      const data = await fs.readFile(filePath);
      const mime = getImageMimeType(path.extname(filePath));
      dataUriByOffset.set(match.index, `data:${mime};base64,${data.toString('base64')}`);
    } catch {
      // Leave broken src as-is
    }
  }

  // Single pass: each matched tag rewrites only its own src attribute.
  return html.replace(imgRegex, (tag, _src, offset) => {
    const dataUri = dataUriByOffset.get(offset);
    if (dataUri === undefined) return tag;
    return tag.replace(
      /(\ssrc=)(["'])[^"']*\2/,
      (_m, prefix, quote) => `${prefix}${quote}${dataUri}${quote}`
    );
  });
}

function replaceThemeVariables(css) {
  const defaults = {
    '--vscode-editor-background': '#ffffff',
    '--vscode-editor-foreground': '#1f2328',
    '--vscode-descriptionForeground': '#656d76',
    '--vscode-editorWidget-border': '#d0d7de',
    '--vscode-editorCursor-foreground': '#0969da',
    '--vscode-textCodeBlock-background': '#f6f8fa',
    '--vscode-textLink-foreground': '#0969da',
    '--vscode-textLink-activeForeground': '#0550ae',
    '--vscode-editor-selectionBackground': 'rgba(9, 105, 218, 0.2)',
    '--vscode-list-hoverBackground': 'rgba(208, 215, 222, 0.32)',
    '--vscode-panel-background': '#f6f8fa',
    '--vscode-input-background': '#f6f8fa',
    '--vscode-button-background': '#0969da',
    '--vscode-button-foreground': '#ffffff',
    '--vscode-button-hoverBackground': '#0550ae',
    '--vscode-scrollbarSlider-background': 'rgba(127, 127, 127, 0.3)',
    '--vscode-scrollbarSlider-hoverBackground': 'rgba(127, 127, 127, 0.5)',
    '--vscode-scrollbarSlider-activeBackground': 'rgba(127, 127, 127, 0.7)',
    '--vscode-errorForeground': '#cf222e',
    '--vscode-inputValidation-errorBackground': 'rgba(207, 34, 46, 0.1)',
    '--vscode-inputValidation-errorBorder': '#cf222e',
    '--vscode-editor-font-family': "'SF Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace",
  };

  const root = Object.entries(defaults)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n');

  return `:root {\n${root}\n}\n\n${css}`;
}

// One rule for every built asset the generator embeds (issue #59): an
// unreadable file warns and names itself in the build log — never a silent
// empty catch. The generated page is a function of the webpack output
// (F-CI-001), and a quietly missing stylesheet is exactly the failure that
// hid four months of broken landing builds.
function warnMissingAsset(label, err) {
  console.warn(
    `generate-landing: ${label} unreadable (${(err && err.code) || err}) — ` +
      'run `npm run compile` to rebuild dist/'
  );
}

// Reads the stylesheets the page inlines, in join order: vendor CSS is
// optional garnish (warn-and-skip) while main.css is the core bundle
// (warn-and-fail). katex.min.css is deliberately absent — when the document
// uses math it is served as a separate cacheable file (assets/katex.min.css)
// so its url(fonts/…) references resolve to the emitted fonts/ directory.
async function readCssParts(vendorDir) {
  const parts = [];
  for (const file of ['github-dark.min.css']) {
    try {
      parts.push(`/* ${file} */\n${await fs.readFile(path.join(vendorDir, file), 'utf8')}`);
    } catch (err) {
      // Vendor CSS is optional garnish — warn, then degrade gracefully.
      warnMissingAsset(file, err);
    }
  }
  try {
    parts.push(
      `/* main.css */\n${await fs.readFile(path.join(repoRoot, 'dist', 'webview', 'main.css'), 'utf8')}`
    );
  } catch (err) {
    // main.css is the core stylesheet, not garnish — warn so the log names
    // the missing file, then fail loudly rather than ship an unstyled page.
    warnMissingAsset('dist/webview/main.css', err);
    throw err;
  }
  return parts;
}

// Landing-only framing appended after the theme variables — leading blank
// lines are part of the emitted stylesheet.
const LANDING_CSS = `

/* Landing page framing */
body {
  padding: 32px 24px 72px;
  background: var(--bg-primary);
}
#preview-content {
  max-width: 960px;
  margin: 0 auto;
}
.frontmatter-card {
  margin-bottom: 28px;
}
#preview-content > h1:first-of-type {
  font-size: clamp(2.4rem, 5vw, 3.8rem);
  line-height: 1.05;
}
#preview-content > p:nth-of-type(1) {
  font-size: 1.1rem;
  color: var(--fg-muted);
}
#preview-content > p:nth-of-type(2) a {
  display: inline-block;
  margin-right: 12px;
  margin-bottom: 8px;
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--input-bg);
  text-decoration: none;
}
#preview-content > p:nth-of-type(2) a:first-child {
  background: var(--button-bg);
  color: var(--button-fg);
  border-color: var(--button-bg);
}
img.preview-image {
  box-shadow: 0 18px 48px rgba(0,0,0,0.12);
}
`;

async function getCombinedCss() {
  const vendorDir = path.join(repoRoot, 'dist', 'webview', 'vendor');
  const parts = await readCssParts(vendorDir);
  let css = parts.join('\n\n');
  css = replaceThemeVariables(css);
  css += LANDING_CSS;
  return css;
}

async function getFaviconDataUri() {
  const iconPath = path.join(repoRoot, 'media', 'icon.png');
  try {
    const data = await fs.readFile(iconPath);
    return `data:image/png;base64,${data.toString('base64')}`;
  } catch {
    // Favicon is cosmetic — omit the <link rel="icon"> when media/icon.png
    // cannot be read.
    return '';
  }
}

// The vendor payloads the page links as separate cacheable files, selected by
// the shared content probe (detectVendorNeeds — the same gate the preview and
// export use). A landing document with no math ships neither KaTeX's script,
// stylesheet nor fonts, and one with no diagrams drops mermaid's ~5.5 MB
// bundle entirely (issue #78).
function planVendorAssets(needs) {
  return {
    scripts: [needs.math ? 'katex.min.js' : '', needs.mermaid ? 'mermaid.min.js' : ''].filter(
      Boolean
    ),
    styles: needs.math ? ['katex.min.css'] : [],
    dirs: needs.math ? ['fonts'] : [],
  };
}

// Writes docs/assets/: the page's own render script and the JSON-LD mirror
// every <script src> must resolve to, then the vendor payloads the plan
// selected. Each vendor copy warns-and-skips per the missing-asset rule, so a
// broken dist/ build never emits a dangling <script src>/<link href>.
async function emitLandingAssets(needs, jsonLd) {
  await fs.rm(assetsDir, { recursive: true, force: true });
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.writeFile(path.join(assetsDir, 'landing.js'), LANDING_SCRIPT, 'utf8');
  await fs.writeFile(path.join(assetsDir, 'ld.json'), jsonLd, 'utf8');
  const vendorDir = path.join(repoRoot, 'dist', 'webview', 'vendor');
  const plan = planVendorAssets(needs);
  const emitted = { scripts: [], styles: [] };
  for (const file of [...plan.scripts, ...plan.styles]) {
    try {
      await fs.copyFile(path.join(vendorDir, file), path.join(assetsDir, file));
      (file.endsWith('.css') ? emitted.styles : emitted.scripts).push(file);
    } catch (err) {
      warnMissingAsset(file, err);
    }
  }
  for (const dir of plan.dirs) {
    try {
      await fs.cp(path.join(vendorDir, dir), path.join(assetsDir, dir), { recursive: true });
    } catch (err) {
      warnMissingAsset(`${dir}/`, err);
    }
  }
  return emitted;
}

// The values the <head> metadata derives from frontmatter and the built
// extension. The published version is package.json's, never the landing
// frontmatter's — a hand-maintained `version:` key goes stale the day it is
// written (issue #71), so pkgVersion wins and the frontmatter value is only a
// fallback for callers that have no package to read.
function resolvePageMetadata(frontmatter, pkgVersion) {
  return {
    siteUrl: 'https://luongnv.com/vscode-markdown-preview/',
    description:
      (frontmatter && frontmatter.subtitle) ||
      'Clean, minimal markdown preview for VS Code with syntax highlighting, Mermaid diagrams, KaTeX math, HTML/PDF export, and interactive features.',
    version: pkgVersion || (frontmatter && frontmatter.version) || '',
    repoUrl:
      (frontmatter && frontmatter.repository) ||
      'https://github.com/luongnv89/vscode-markdown-preview',
    marketplaceUrl: (frontmatter && frontmatter.marketplace) || '',
  };
}

// The schema.org SoftwareApplication payload — title/description come from
// the landing frontmatter, the version from package.json. Returned as bare
// JSON (no <script> wrapper): buildSeoMeta inlines it for crawlers while
// emitLandingAssets mirrors it byte-for-byte to assets/ld.json, the file the
// tag's src points at — a data block never fetches src, so crawlers keep the
// inline copy and the page's "every script has a src" contract still holds
// (issue #78). Emitted compact so `"softwareVersion":"X.Y.Z"` stays greppable
// without whitespace assumptions. Escaping `<` keeps a literal "</script>"
// inside a value from ending the data block early while staying valid JSON.
function buildJsonLd(meta) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: meta.title,
    description: meta.description,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Windows, macOS, Linux',
    softwareVersion: meta.version,
    author: {
      '@type': 'Person',
      name: 'luongnv89',
      url: 'https://github.com/luongnv89',
    },
    url: meta.siteUrl,
    downloadUrl: meta.marketplaceUrl,
    codeRepository: meta.repoUrl,
    license: 'https://opensource.org/licenses/MIT',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    image: `${meta.repoUrl}/raw/main/media/screenshot.png`,
  }).replace(/</g, '\\u003c');
}

// The SEO/OpenGraph/Twitter block for the page <head>. meta carries the
// resolvePageMetadata() fields plus { title, faviconUri }; jsonLd is the
// buildJsonLd() payload, inlined inside a src-bearing data-block script.
function buildSeoMeta(meta, jsonLd) {
  return `
  <meta name="description" content="${escapeHtml(meta.description)}">
  <meta name="author" content="luongnv89">
  <meta name="theme-color" content="#0969da" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#1e1e1e" media="(prefers-color-scheme: dark)">
  <link rel="canonical" href="${escapeHtml(meta.siteUrl)}">
  ${meta.faviconUri ? `<link rel="icon" type="image/png" href="${meta.faviconUri}">` : ''}

  <!-- OpenGraph -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(meta.title)}">
  <meta property="og:description" content="${escapeHtml(meta.description)}">
  <meta property="og:url" content="${escapeHtml(meta.siteUrl)}">
  <meta property="og:image" content="${escapeHtml(meta.repoUrl)}/raw/main/media/screenshot.png">
  <meta property="og:image:alt" content="Markdown Preview Pro — VS Code extension preview">
  <meta property="og:site_name" content="Markdown Preview Pro">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(meta.title)}">
  <meta name="twitter:description" content="${escapeHtml(meta.description)}">
  <meta name="twitter:image" content="${escapeHtml(meta.repoUrl)}/raw/main/media/screenshot.png">

  <!-- JSON-LD Structured Data -->
  <script type="application/ld+json" src="assets/ld.json">
${jsonLd}
  </script>`;
}

// The client-side script shipped as assets/landing.js: theme toolbar with
// localStorage persistence, copy buttons on code blocks, KaTeX rendering,
// Mermaid rendering. Loaded with `defer` after the gated vendor scripts, so
// their globals are defined when this IIFE runs.
const LANDING_SCRIPT = `
const COPY_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M3 11V3C3 2.44772 3.44772 2 4 2H10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
const CHECK_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SUN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
const MOON_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const THEME_STORAGE_KEY = 'markdown-preview-pro-landing-theme';

function wrapCodeBlocks() {
  const codeBlocks = document.querySelectorAll('pre.hljs:not(.mermaid), pre.code-block:not(.mermaid)');
  codeBlocks.forEach((pre) => {
    if (pre.parentElement && pre.parentElement.classList.contains('code-block-wrapper')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';

    const lang = pre.getAttribute('data-lang') || '';
    const header = document.createElement('div');
    header.className = 'code-block-header';

    if (lang) {
      const langLabel = document.createElement('span');
      langLabel.className = 'code-block-lang';
      langLabel.textContent = lang;
      header.appendChild(langLabel);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-button';
    copyBtn.innerHTML = COPY_ICON;
    copyBtn.title = 'Copy code';
    copyBtn.addEventListener('click', async () => {
      const code = pre.querySelector('code')?.textContent || pre.textContent || '';
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      copyBtn.innerHTML = CHECK_ICON;
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.innerHTML = COPY_ICON;
        copyBtn.classList.remove('copied');
      }, 2000);
    });

    header.appendChild(copyBtn);
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  });
}

function getStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return 'dark';
  } catch {
    // localStorage unavailable (private mode etc.) — default to dark.
    return 'dark';
  }
}

function setTheme(theme, button) {
  document.body.classList.remove('preview-theme-light', 'preview-theme-dark');
  document.body.classList.add(theme === 'dark' ? 'preview-theme-dark' : 'preview-theme-light');
  if (button) {
    button.innerHTML = theme === 'dark' ? SUN_ICON : MOON_ICON;
    button.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    button.setAttribute('aria-label', button.title);
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage can throw (private mode, quota, disabled storage) — theme
    // persistence is best-effort, so a failed write is safe to ignore.
  }
}

function ensureThemeToolbar(initialTheme) {
  const toolbar = document.createElement('div');
  toolbar.className = 'preview-toolbar';
  const button = document.createElement('button');
  button.className = 'toolbar-button';
  button.type = 'button';
  toolbar.appendChild(button);
  document.body.appendChild(toolbar);
  setTheme(initialTheme, button);
  button.addEventListener('click', async () => {
    const nextTheme = document.body.classList.contains('preview-theme-dark') ? 'light' : 'dark';
    setTheme(nextTheme, button);
    await renderMermaid(nextTheme);
  });
}

async function renderMermaid(theme) {
  if (typeof mermaid === 'undefined') return;
  mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default', securityLevel: 'strict', layout: 'dagre', look: 'classic' });
  var blocks = document.querySelectorAll('.mermaid-block');
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    var pre = block.querySelector('pre.mermaid');
    var code = block.getAttribute('data-mermaid-source') || (pre ? pre.textContent || '' : '');
    if (!code) continue;
    block.setAttribute('data-mermaid-source', code);
    var id = 'mermaid-export-' + theme + '-' + i;
    try {
      var result = await mermaid.render(id, code);
      block.innerHTML = result.svg;
      block.setAttribute('data-processed', 'true');
      block.classList.add('mermaid-rendered');
    } catch (err) {
      block.innerHTML = '<div class="mermaid-error">Diagram error: ' + err.message + '</div>';
      block.setAttribute('data-processed', 'true');
    }
  }
}

(async function() {
  const initialTheme = getStoredTheme();
  setTheme(initialTheme);
  ensureThemeToolbar(initialTheme);
  if (typeof katex !== 'undefined') {
    document.querySelectorAll('.katex-inline[data-math]').forEach(function(el) {
      try { katex.render(el.getAttribute('data-math'), el, { throwOnError: false, displayMode: false }); } catch (e) { /* throwOnError:false already renders errors in place; this only guards an unexpected engine throw */ }
    });
    document.querySelectorAll('.katex-block[data-math]').forEach(function(el) {
      try { katex.render(el.getAttribute('data-math'), el, { throwOnError: false, displayMode: true }); } catch (e) { /* same guard as the inline-math path above */ }
    });
  }
  wrapCodeBlocks();
  await renderMermaid(initialTheme);
})();
`;

// Every <script> in the page carries a src (issue #78): vendor runtimes are
// cacheable files emitted only when the rendered markup uses them, the render
// script is assets/landing.js, and even the JSON-LD data block names its
// assets/ld.json mirror — total inline script text stays under a kilobyte.
async function buildHtml(markdownHtml, title, documentPath, frontmatter, pkgVersion, needs) {
  const css = await getCombinedCss();
  const htmlWithEmbeddedImages = await embedImages(markdownHtml, documentPath);
  const faviconUri = await getFaviconDataUri();
  const pageMeta = { title, faviconUri, ...resolvePageMetadata(frontmatter, pkgVersion) };
  const jsonLd = buildJsonLd(pageMeta);
  const seoMeta = buildSeoMeta(pageMeta, jsonLd);
  const emitted = await emitLandingAssets(needs, jsonLd);
  const vendorStyleLinks = emitted.styles
    .map((file) => `  <link rel="stylesheet" href="assets/${file}">`)
    .join('\n');
  const vendorScriptTags = emitted.scripts
    .map((file) => `  <script src="assets/${file}" defer></script>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
${seoMeta}
${vendorStyleLinks}
  <style>${css}</style>
${vendorScriptTags}
  <script src="assets/landing.js" defer></script>
</head>
<body class="preview-theme-dark">
  <div id="preview-content">
${htmlWithEmbeddedImages}
  </div>
</body>
</html>`;
}

async function main() {
  const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const raw = await fs.readFile(landingPath, 'utf8');
  const { frontmatter, body } = parseFrontmatter(raw);
  const md = createLandingRenderer();
  const renderedBody = md.render(body);
  const html = `${frontmatter ? renderFrontmatterHtml(frontmatter) : ''}\n${renderedBody}`;
  const title = (frontmatter && frontmatter.title) || pkg.displayName || pkg.name;
  // The shared content probe gates which vendor runtimes the page links —
  // the same markup the browser will render, so a feature the document does
  // not use is neither emitted nor referenced.
  const needs = detectVendorNeeds(html, {
    enableKatex: LANDING_CONFIG.enableKatex,
    enableMermaid: LANDING_CONFIG.enableMermaid,
    enableExcalidraw: LANDING_CONFIG.enableExcalidraw,
  });
  let standalone = await buildHtml(html, title, landingPath, frontmatter, pkg.version, needs);
  // Normalize whitespace to pass pre-commit hooks (trailing whitespace, final newline)
  standalone = standalone.replace(/[^\S\n]+$/gm, '').replace(/\n*$/, '\n');
  await fs.writeFile(outputPath, standalone, 'utf8');
  console.log(
    'Generated docs/index.html from docs/landing.md using Markdown Preview Pro rendering stack'
  );
}

// Exported for tests (src/test/suite/buildDeps.test.ts,
// src/test/suite/sharedEngine.test.ts, src/test/suite/landingPage.test.ts) —
// the landing generator renders through the compiled shared engine, which
// must keep producing checkbox markup without markdown-it-task-lists, and the
// asset plan pins the content gate's mapping without a second full build.
module.exports = { createLandingRenderer, planVendorAssets, generateLanding: main };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
