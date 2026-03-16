const fs = require('node:fs/promises');
const path = require('node:path');
const MarkdownIt = require('markdown-it');
const hljs = require('highlight.js');
const YAML = require('yaml');

const repoRoot = path.resolve(__dirname, '..');
const landingPath = path.join(repoRoot, 'docs', 'landing.md');
const outputPath = path.join(repoRoot, 'docs', 'index.html');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: null, body: content };
  }
  try {
    return {
      frontmatter: YAML.parse(match[1]) || null,
      body: content.slice(match[0].length),
    };
  } catch {
    return { frontmatter: null, body: content.slice(match[0].length) };
  }
}

function isUrl(value) {
  return /^https?:\/\//.test(value);
}

function isImageUrl(value) {
  return /\.(png|svg|jpg|jpeg|gif|webp)(\?.*)?$/i.test(value) || /shields\.io/.test(value);
}

function renderFrontmatterValue(value) {
  if (typeof value === 'string') {
    if (isImageUrl(value)) {
      return `<img src="${escapeHtml(value)}" alt="badge" class="frontmatter-badge">`;
    }
    if (isUrl(value)) {
      return `<a href="${escapeHtml(value)}" class="frontmatter-link">${escapeHtml(value)}</a>`;
    }
    return escapeHtml(value);
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return `<code>${escapeHtml(value)}</code>`;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => `<span class="frontmatter-tag">${renderFrontmatterValue(item)}</span>`)
      .join(' ');
  }
  if (typeof value === 'object' && value !== null) {
    return `<code>${escapeHtml(JSON.stringify(value, null, 2))}</code>`;
  }
  return escapeHtml(String(value));
}

function renderFrontmatterHtml(data) {
  const title = typeof data.title === 'string' ? escapeHtml(data.title) : 'Metadata';
  const rows = Object.entries(data)
    .map(
      ([key, value]) => `<tr>
  <td class="frontmatter-key">${escapeHtml(key)}</td>
  <td class="frontmatter-value">${renderFrontmatterValue(value)}</td>
</tr>`
    )
    .join('\n');

  return `<details open class="frontmatter-card">
<summary class="frontmatter-summary">${title}</summary>
<table class="frontmatter-table">
  <tbody>
${rows}
  </tbody>
</table>
</details>`;
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

function getFontMimeType(ext) {
  return (
    {
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.ttf': 'font/ttf',
    }[ext.toLowerCase()] || 'application/octet-stream'
  );
}

async function embedImages(html, documentPath) {
  const matches = [...html.matchAll(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/g)];
  let result = html;

  for (const match of matches) {
    const originalSrc = match[1];
    if (originalSrc.startsWith('data:') || /^https?:\/\//.test(originalSrc)) continue;

    const filePath = resolveImageUri(originalSrc, documentPath);
    try {
      const data = await fs.readFile(filePath);
      const mime = getImageMimeType(path.extname(filePath));
      const dataUri = `data:${mime};base64,${data.toString('base64')}`;
      result = result.replace(originalSrc, dataUri);
    } catch {
      // Leave broken src as-is
    }
  }

  return result;
}

async function embedFonts(css, fontsDir) {
  const matches = [...css.matchAll(/url\((?:['"]?)(?:\.\/)?fonts\/([^'")\s]+)(?:['"]?)\)/g)];
  let result = css;

  for (const match of matches) {
    const fontPath = path.join(fontsDir, match[1]);
    try {
      const data = await fs.readFile(fontPath);
      const mime = getFontMimeType(path.extname(fontPath));
      result = result.replace(match[0], `url(data:${mime};base64,${data.toString('base64')})`);
    } catch {
      // Keep original URL if font missing
    }
  }

  return result;
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

function createMarkdownEngine() {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: false,
    highlight: (str, lang) => {
      if (lang && lang !== 'mermaid' && hljs.getLanguage(lang)) {
        try {
          const result = hljs.highlight(str, { language: lang, ignoreIllegals: true });
          return `<pre class="hljs code-block" data-lang="${lang}"><code>${result.value}</code></pre>`;
        } catch {
          // ignore
        }
      }
      if (lang === 'mermaid') {
        return `<div class="mermaid-block" data-processed="false"><pre class="mermaid">${md.utils.escapeHtml(str)}</pre></div>`;
      }
      return `<pre class="hljs code-block"><code>${md.utils.escapeHtml(str)}</code></pre>`;
    },
  });

  const blockTokens = [
    'paragraph_open',
    'heading_open',
    'blockquote_open',
    'bullet_list_open',
    'ordered_list_open',
    'table_open',
    'hr',
    'html_block',
  ];

  for (const tokenType of blockTokens) {
    const defaultRender =
      md.renderer.rules[tokenType] ||
      ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    md.renderer.rules[tokenType] = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      if (token.map && token.map.length >= 1) {
        token.attrSet('data-line', String(token.map[0]));
        token.attrJoin('class', 'code-line');
      }
      return defaultRender(tokens, idx, options, env, self);
    };
  }

  const defaultListItemRender =
    md.renderer.rules.list_item_open ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.list_item_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token.map && token.map.length >= 1) {
      token.attrSet('data-line', String(token.map[0]));
    }
    return defaultListItemRender(tokens, idx, options, env, self);
  };

  md.core.ruler.after('inline', 'task-lists', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'inline') continue;
      const content = tokens[i].content;
      if (i >= 2 && tokens[i - 2].type === 'list_item_open') {
        const checkboxMatch = content.match(/^\[([ xX])\]\s*/);
        if (checkboxMatch) {
          const checked = checkboxMatch[1] !== ' ';
          const listItemToken = tokens[i - 2];
          listItemToken.attrJoin('class', 'task-list-item');
          const checkedAttr = checked ? ' checked' : '';
          const line = listItemToken.map ? String(listItemToken.map[0]) : '0';
          tokens[i].content = content.replace(/^\[([ xX])\]\s*/, '');
          const children = tokens[i].children || [];
          tokens[i].children = children;
          const checkboxToken = new state.Token('html_inline', '', 0);
          checkboxToken.content = `<input type="checkbox" data-line="${line}"${checkedAttr}> `;
          if (children.length > 0 && children[0].type === 'text') {
            children[0].content = children[0].content.replace(/^\[([ xX])\]\s*/, '');
          }
          children.unshift(checkboxToken);
        }
      }
    }
  });

  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false;
    const start = state.pos + 1;
    let end = start;
    while (end < state.posMax) {
      if (state.src[end] === '$' && state.src[end - 1] !== '\\') break;
      end++;
    }
    if (end >= state.posMax) return false;
    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.content = state.src.slice(start, end);
      token.markup = '$';
    }
    state.pos = end + 1;
    return true;
  });

  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span class="katex-inline" data-math="${md.utils.escapeHtml(tokens[idx].content)}">${md.utils.escapeHtml(tokens[idx].content)}</span>`;

  md.block.ruler.after('blockquote', 'math_block', (state, startLine, endLine, silent) => {
    const startPos = state.bMarks[startLine] + state.tShift[startLine];
    const maxPos = state.eMarks[startLine];
    if (startPos + 2 > maxPos) return false;
    if (state.src.slice(startPos, startPos + 2) !== '$$') return false;
    if (silent) return true;

    let nextLine = startLine;
    let hasEnding = false;
    while (nextLine < endLine) {
      nextLine++;
      if (nextLine >= endLine) break;
      const lineStartPos = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineMaxPos = state.eMarks[nextLine];
      if (lineStartPos < lineMaxPos && state.src.slice(lineStartPos, lineStartPos + 2) === '$$') {
        hasEnding = true;
        break;
      }
    }
    if (!hasEnding) return false;
    state.line = nextLine + 1;
    const token = state.push('math_block', 'div', 0);
    token.block = true;
    token.content = state.getLines(startLine + 1, nextLine, state.tShift[startLine], true).trim();
    token.map = [startLine, nextLine + 1];
    token.markup = '$$';
    return true;
  });

  md.renderer.rules.math_block = (tokens, idx) => {
    const line = tokens[idx].map ? tokens[idx].map[0] : 0;
    return `<div class="katex-block code-line" data-line="${line}" data-math="${md.utils.escapeHtml(tokens[idx].content)}">${md.utils.escapeHtml(tokens[idx].content)}</div>\n`;
  };

  const defaultImageRender =
    md.renderer.rules.image ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    token.attrJoin('class', 'preview-image');
    return defaultImageRender(tokens, idx, options, env, self);
  };

  return md;
}

async function getCombinedCss() {
  const parts = [];
  const vendorDir = path.join(repoRoot, 'dist', 'webview', 'vendor');
  for (const file of ['katex.min.css', 'github-dark.min.css']) {
    try {
      parts.push(`/* ${file} */\n${await fs.readFile(path.join(vendorDir, file), 'utf8')}`);
    } catch {}
  }
  parts.push(
    `/* main.css */\n${await fs.readFile(path.join(repoRoot, 'dist', 'webview', 'main.css'), 'utf8')}`
  );
  let css = parts.join('\n\n');
  css = await embedFonts(css, path.join(vendorDir, 'fonts'));
  css = replaceThemeVariables(css);
  css += `

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
  return css;
}

async function getFaviconDataUri() {
  const iconPath = path.join(repoRoot, 'media', 'icon.png');
  try {
    const data = await fs.readFile(iconPath);
    return `data:image/png;base64,${data.toString('base64')}`;
  } catch {
    return '';
  }
}

async function buildHtml(markdownHtml, title, documentPath, frontmatter) {
  const css = await getCombinedCss();
  const vendorDir = path.join(repoRoot, 'dist', 'webview', 'vendor');
  const katexJs = await fs.readFile(path.join(vendorDir, 'katex.min.js'), 'utf8').catch(() => '');
  const mermaidJs = await fs
    .readFile(path.join(vendorDir, 'mermaid.min.js'), 'utf8')
    .catch(() => '');
  const htmlWithEmbeddedImages = await embedImages(markdownHtml, documentPath);
  const faviconUri = await getFaviconDataUri();

  const siteUrl = 'https://luongnv.com/vscode-markdown-preview/';
  const description = (frontmatter && frontmatter.subtitle) ||
    'Clean, minimal markdown preview for VS Code with syntax highlighting, Mermaid diagrams, KaTeX math, HTML/PDF export, and interactive features.';
  const version = (frontmatter && frontmatter.version) || '';
  const repoUrl = (frontmatter && frontmatter.repository) || 'https://github.com/luongnv89/vscode-markdown-preview';
  const marketplaceUrl = (frontmatter && frontmatter.marketplace) || '';
  const screenshotUri = await (async () => {
    try {
      const data = await fs.readFile(path.join(repoRoot, 'media', 'screenshot.png'));
      return `data:image/png;base64,${data.toString('base64')}`;
    } catch {
      return `${repoUrl}/raw/main/media/screenshot.png`;
    }
  })();

  const seoMeta = `
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="author" content="luongnv89">
  <meta name="theme-color" content="#0969da" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#1e1e1e" media="(prefers-color-scheme: dark)">
  <link rel="canonical" href="${escapeHtml(siteUrl)}">
  ${faviconUri ? `<link rel="icon" type="image/png" href="${faviconUri}">` : ''}

  <!-- OpenGraph -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(siteUrl)}">
  <meta property="og:image" content="${escapeHtml(repoUrl)}/raw/main/media/screenshot.png">
  <meta property="og:image:alt" content="Markdown Preview Pro — VS Code extension preview">
  <meta property="og:site_name" content="Markdown Preview Pro">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(repoUrl)}/raw/main/media/screenshot.png">

  <!-- JSON-LD Structured Data -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "${escapeHtml(title)}",
    "description": "${escapeHtml(description)}",
    "applicationCategory": "DeveloperApplication",
    "operatingSystem": "Windows, macOS, Linux",
    "softwareVersion": "${escapeHtml(version)}",
    "author": {
      "@type": "Person",
      "name": "luongnv89",
      "url": "https://github.com/luongnv89"
    },
    "url": "${escapeHtml(siteUrl)}",
    "downloadUrl": "${escapeHtml(marketplaceUrl)}",
    "codeRepository": "${escapeHtml(repoUrl)}",
    "license": "https://opensource.org/licenses/MIT",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD"
    },
    "image": "${escapeHtml(repoUrl)}/raw/main/media/screenshot.png"
  }
  </script>`;

  const renderScript = `
<script>
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
  } catch {}
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
  mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default', securityLevel: 'loose' });
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
      try { katex.render(el.getAttribute('data-math'), el, { throwOnError: false, displayMode: false }); } catch (e) {}
    });
    document.querySelectorAll('.katex-block[data-math]').forEach(function(el) {
      try { katex.render(el.getAttribute('data-math'), el, { throwOnError: false, displayMode: true }); } catch (e) {}
    });
  }
  wrapCodeBlocks();
  await renderMermaid(initialTheme);
})();
</script>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
${seoMeta}
  <style>${css}</style>
  <script>${katexJs}</script>
  <script>${mermaidJs}</script>
</head>
<body class="preview-theme-dark">
  <div id="preview-content">
${htmlWithEmbeddedImages}
  </div>
  ${renderScript}
</body>
</html>`;
}

async function main() {
  const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const raw = await fs.readFile(landingPath, 'utf8');
  const { frontmatter, body } = parseFrontmatter(raw);
  const md = createMarkdownEngine();
  const renderedBody = md.render(body);
  const html = `${frontmatter ? renderFrontmatterHtml(frontmatter) : ''}\n${renderedBody}`;
  const title = (frontmatter && frontmatter.title) || pkg.displayName || pkg.name;
  let standalone = await buildHtml(html, title, landingPath, frontmatter);
  // Normalize whitespace to pass pre-commit hooks (trailing whitespace, final newline)
  standalone = standalone.replace(/[^\S\n]+$/gm, '').replace(/\n*$/, '\n');
  await fs.writeFile(outputPath, standalone, 'utf8');
  console.log(
    'Generated docs/index.html from docs/landing.md using Markdown Preview Pro rendering stack'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
