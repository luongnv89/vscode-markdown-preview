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
    '--vscode-editor-background': '#111111',
    '--vscode-editor-foreground': '#e6edf3',
    '--vscode-descriptionForeground': '#9aa4b2',
    '--vscode-editorWidget-border': 'rgba(127, 127, 127, 0.2)',
    '--vscode-editorCursor-foreground': '#7cc7ff',
    '--vscode-textCodeBlock-background': 'rgba(127, 127, 127, 0.1)',
    '--vscode-textLink-foreground': '#58a6ff',
    '--vscode-textLink-activeForeground': '#79c0ff',
    '--vscode-editor-selectionBackground': 'rgba(88, 166, 255, 0.22)',
    '--vscode-list-hoverBackground': 'rgba(127, 127, 127, 0.08)',
    '--vscode-panel-background': '#161b22',
    '--vscode-input-background': 'rgba(127, 127, 127, 0.08)',
    '--vscode-button-background': '#238636',
    '--vscode-button-foreground': '#ffffff',
    '--vscode-button-hoverBackground': '#2ea043',
    '--vscode-scrollbarSlider-background': 'rgba(127, 127, 127, 0.3)',
    '--vscode-scrollbarSlider-hoverBackground': 'rgba(127, 127, 127, 0.5)',
    '--vscode-scrollbarSlider-activeBackground': 'rgba(127, 127, 127, 0.7)',
    '--vscode-errorForeground': '#f85149',
    '--vscode-inputValidation-errorBackground': 'rgba(248, 81, 73, 0.1)',
    '--vscode-inputValidation-errorBorder': '#f85149',
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
  background:
    radial-gradient(circle at top, rgba(88, 166, 255, 0.12), transparent 28%),
    var(--vscode-editor-background);
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
  color: var(--vscode-descriptionForeground);
}
#preview-content > p:nth-of-type(2) a {
  display: inline-block;
  margin-right: 12px;
  margin-bottom: 8px;
  padding: 10px 14px;
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 10px;
  background: var(--vscode-input-background);
  text-decoration: none;
}
#preview-content > p:nth-of-type(2) a:first-child {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-color: var(--vscode-button-background);
}
img.preview-image {
  box-shadow: 0 18px 48px rgba(0,0,0,0.28);
}
`;
  return css;
}

async function buildHtml(markdownHtml, title, documentPath) {
  const css = await getCombinedCss();
  const vendorDir = path.join(repoRoot, 'dist', 'webview', 'vendor');
  const katexJs = await fs.readFile(path.join(vendorDir, 'katex.min.js'), 'utf8').catch(() => '');
  const mermaidJs = await fs
    .readFile(path.join(vendorDir, 'mermaid.min.js'), 'utf8')
    .catch(() => '');
  const htmlWithEmbeddedImages = await embedImages(markdownHtml, documentPath);

  const renderScript = `
<script>
(async function() {
  if (typeof katex !== 'undefined') {
    document.querySelectorAll('.katex-inline[data-math]').forEach(function(el) {
      try { katex.render(el.getAttribute('data-math'), el, { throwOnError: false, displayMode: false }); } catch (e) {}
    });
    document.querySelectorAll('.katex-block[data-math]').forEach(function(el) {
      try { katex.render(el.getAttribute('data-math'), el, { throwOnError: false, displayMode: true }); } catch (e) {}
    });
  }
  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
    var blocks = document.querySelectorAll('.mermaid-block[data-processed="false"]');
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      var pre = block.querySelector('pre.mermaid');
      if (!pre) continue;
      var code = pre.textContent || '';
      var id = 'mermaid-export-' + i;
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
})();
</script>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${escapeHtml(title)}">
  <title>${escapeHtml(title)}</title>
  <style>${css}</style>
  <script>${katexJs}</script>
  <script>${mermaidJs}</script>
</head>
<body>
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
  const standalone = await buildHtml(html, title, landingPath);
  await fs.writeFile(outputPath, standalone, 'utf8');
  console.log(
    'Generated docs/index.html from docs/landing.md using Markdown Preview Pro rendering stack'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
