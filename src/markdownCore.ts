import MarkdownIt from 'markdown-it';
import type { RendererRule, Token } from 'markdown-it';
import hljs from 'highlight.js';

// Shared markdown-it rendering pipeline for Markdown Preview Pro. This module
// is vscode-free on purpose: webpack compiles it to dist/markdownCore.js
// (CommonJS) so scripts/generate-landing.cjs — plain Node, no vscode — renders
// with the exact same engine the extension uses, instead of reimplementing it.
// Host-specific behaviour (image URI resolution, extra token decoration) is
// injected through MarkdownCoreHooks.

// markdown-it 15 bundles its own declarations (@types/markdown-it removed):
// the default export is a callable whose instance type is not named
// `MarkdownIt`, so annotate via InstanceType rather than the namespace.
export type MarkdownItInstance = InstanceType<typeof MarkdownIt>;

// The subset of PreviewConfig the rendering pipeline reads. PreviewConfig
// itself is a superset and stays assignable; the landing generator builds an
// equivalent literal.
export interface MarkdownCoreConfig {
  typographer: boolean;
  lineBreaks: boolean;
  enableMermaid: boolean;
  enableExcalidraw: boolean;
  enableCheckboxes: boolean;
  enableKatex: boolean;
}

// Host seam: the extension resolves image srcs against the document/webview,
// the landing generator leaves srcs untouched (its embedImages pass rewrites
// them to data URIs afterwards) and adds its own preview-image class.
export interface MarkdownCoreHooks {
  resolveImageSrc?: (src: string) => string;
  decorateImageToken?: (token: Token) => void;
}

// Matches a complete raw <img ...> tag: the attribute run accepts quoted
// values, so a '>' inside quotes does not end the match early the way a
// [^>] attribute run would.
const RAW_HTML_IMAGE_TAG_PATTERN = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

// Matches a quoted src attribute inside an already-isolated tag; the leading
// boundary keeps lookalike attributes (data-src, srcset) from matching.
const RAW_HTML_IMAGE_SRC_PATTERN = /(^|[\s/])(src\s*=\s*)(["'])(.*?)\3/i;

export function createMarkdownIt(
  config: MarkdownCoreConfig,
  hooks: MarkdownCoreHooks = {}
): MarkdownItInstance {
  const resolveImageSrc = hooks.resolveImageSrc ?? ((src: string) => src);
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: config.typographer,
    breaks: config.lineBreaks,
    highlight: (str: string, lang: string): string => highlightCodeBlock(md, config, str, lang),
  });

  addLineNumbers(md);

  // Task list support
  if (config.enableCheckboxes) {
    addTaskListSupport(md);
  }

  // KaTeX support — one registration function per rule
  if (config.enableKatex) {
    addInlineMathRule(md);
    addInlineMathRenderer(md);
    addBlockMathRule(md);
    addBlockMathRenderer(md);
  }

  // Image rendering (local-image resolution + raw-HTML img rewrite)
  addImageSupport(md, resolveImageSrc, hooks.decorateImageToken);

  return md;
}

// Fence highlight hook: hljs for known languages, diagram blocks gated on the
// feature flags, escaped plain code block otherwise.
function highlightCodeBlock(
  md: MarkdownItInstance,
  config: MarkdownCoreConfig,
  str: string,
  lang: string
): string {
  if (lang && lang !== 'mermaid' && lang !== 'excalidraw' && hljs.getLanguage(lang)) {
    try {
      const result = hljs.highlight(str, { language: lang, ignoreIllegals: true });
      return `<pre class="hljs code-block" data-lang="${lang}"><code>${result.value}</code></pre>`;
    } catch {
      // Fall through to default
    }
  }
  // Diagram blocks are gated on the feature flags: with the flag off the
  // fence falls through to the plain code block below, so the preview
  // neither renders the diagram nor needs its vendor script.
  if (lang === 'mermaid' && config.enableMermaid) {
    const escaped = md.utils.escapeHtml(str);
    return `<div class="mermaid-block" data-processed="false" data-source="${escaped}"><pre class="mermaid">${escaped}</pre></div>`;
  }
  if (lang === 'excalidraw' && config.enableExcalidraw) {
    const escaped = md.utils.escapeHtml(str);
    return `<div class="excalidraw-block" data-processed="false" data-source="${escaped}"><pre class="excalidraw-source">${escaped}</pre></div>`;
  }
  // Auto-detect
  const escaped = md.utils.escapeHtml(str);
  return `<pre class="hljs code-block"><code>${escaped}</code></pre>`;
}

function addLineNumbers(md: MarkdownItInstance): void {
  registerFrontmatterLineOffset(md);
  registerBlockTokenLineNumbers(md);
  registerListItemLineNumber(md);
}

// Shift token source maps by the number of frontmatter lines stripped
// before rendering, so every data-line attribute below already carries the
// offset — no post-render rewrite of the emitted HTML is needed. Runs right
// after the block parser so the task-list and math rules (and every other
// map reader) see source-document line numbers.
function registerFrontmatterLineOffset(md: MarkdownItInstance): void {
  md.core.ruler.after('block', 'frontmatter-line-offset', (state) => {
    // env is typed `unknown` under markdown-it 15's bundled declarations —
    // only a numeric lineOffset participates in the shift.
    const offset = typeof state.env?.lineOffset === 'number' ? state.env.lineOffset : 0;
    if (offset === 0) {
      return;
    }
    for (const token of state.tokens) {
      if (token.map) {
        token.map = [token.map[0] + offset, token.map[1] + offset];
      }
    }
  });
}

// Add data-line to block-level opening tokens
function registerBlockTokenLineNumbers(md: MarkdownItInstance): void {
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
    const defaultRender: RendererRule =
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
}

// Special handling for list items (for checkbox support)
function registerListItemLineNumber(md: MarkdownItInstance): void {
  const defaultListItemRender: RendererRule =
    md.renderer.rules['list_item_open'] ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules['list_item_open'] = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token.map && token.map.length >= 1) {
      token.attrSet('data-line', String(token.map[0]));
    }
    return defaultListItemRender(tokens, idx, options, env, self);
  };
}

function addTaskListSupport(md: MarkdownItInstance): void {
  // Transform task list items: - [ ] and - [x]
  md.core.ruler.after('inline', 'task-lists', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'inline') {
        continue;
      }
      const content = tokens[i].content;
      // Check if parent is a list item
      if (i >= 2 && tokens[i - 2].type === 'list_item_open') {
        const checkboxMatch = content.match(/^\[([ xX])\]\s*/);
        if (checkboxMatch) {
          const checked = checkboxMatch[1] !== ' ';
          const listItemToken = tokens[i - 2];
          listItemToken.attrJoin('class', 'task-list-item');

          // Replace the checkbox text with an actual checkbox element
          const checkedAttr = checked ? ' checked' : '';
          const line = listItemToken.map ? String(listItemToken.map[0]) : '0';
          tokens[i].content = content.replace(/^\[([ xX])\]\s*/, '');
          const children = tokens[i].children || [];
          tokens[i].children = children;

          // Prepend checkbox token
          const checkboxToken = new state.Token('html_inline', '', 0);
          checkboxToken.content = `<input type="checkbox" data-line="${line}"${checkedAttr}> `;

          if (children.length > 0) {
            // Remove the [x] or [ ] text from the first child
            const firstChild = children[0];
            if (firstChild.type === 'text') {
              firstChild.content = firstChild.content.replace(/^\[([ xX])\]\s*/, '');
            }
          }
          children.unshift(checkboxToken);
        }
      }
    }
  });
}

// Inline math rule: $...$ — a lone $, never $$, closed by an unescaped $.
function addInlineMathRule(md: MarkdownItInstance): void {
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    if (state.src[state.pos] !== '$') {
      return false;
    }
    // Don't match $$
    if (state.src[state.pos + 1] === '$') {
      return false;
    }

    const start = state.pos + 1;
    let end = start;
    while (end < state.posMax) {
      if (state.src[end] === '$' && state.src[end - 1] !== '\\') {
        break;
      }
      end++;
    }

    if (end >= state.posMax) {
      return false;
    }

    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.content = state.src.slice(start, end);
      token.markup = '$';
    }

    state.pos = end + 1;
    return true;
  });
}

function addInlineMathRenderer(md: MarkdownItInstance): void {
  md.renderer.rules['math_inline'] = (tokens, idx) => {
    return `<span class="katex-inline" data-math="${md.utils.escapeHtml(tokens[idx].content)}">${md.utils.escapeHtml(tokens[idx].content)}</span>`;
  };
}

// Block math rule: $$...$$ — an opening $$ line and a later closing $$ line.
function addBlockMathRule(md: MarkdownItInstance): void {
  md.block.ruler.after('blockquote', 'math_block', (state, startLine, endLine, silent) => {
    const startPos = state.bMarks[startLine] + state.tShift[startLine];
    const maxPos = state.eMarks[startLine];

    if (startPos + 2 > maxPos) {
      return false;
    }
    if (state.src.slice(startPos, startPos + 2) !== '$$') {
      return false;
    }

    if (silent) {
      return true;
    }

    let nextLine = startLine;
    let hasEnding = false;

    while (nextLine < endLine) {
      nextLine++;
      if (nextLine >= endLine) {
        break;
      }

      const lineStartPos = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineMaxPos = state.eMarks[nextLine];

      if (lineStartPos < lineMaxPos && state.src.slice(lineStartPos, lineStartPos + 2) === '$$') {
        hasEnding = true;
        break;
      }
    }

    if (!hasEnding) {
      return false;
    }

    state.line = nextLine + 1;

    const token = state.push('math_block', 'div', 0);
    token.block = true;
    token.content = state.getLines(startLine + 1, nextLine, state.tShift[startLine], true).trim();
    token.map = [startLine, nextLine + 1];
    token.markup = '$$';

    return true;
  });
}

function addBlockMathRenderer(md: MarkdownItInstance): void {
  md.renderer.rules['math_block'] = (tokens, idx) => {
    const line = tokens[idx].map ? tokens[idx].map![0] : 0;
    return `<div class="katex-block code-line" data-line="${line}" data-math="${md.utils.escapeHtml(tokens[idx].content)}">${md.utils.escapeHtml(tokens[idx].content)}</div>\n`;
  };
}

function addImageSupport(
  md: MarkdownItInstance,
  resolveImageSrc: (src: string) => string,
  decorateImageToken?: (token: Token) => void
): void {
  const defaultImageRender: RendererRule =
    md.renderer.rules.image ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    // attrGet is `string | number | null` under the bundled declarations;
    // an image src is always a string in practice.
    const srcAttr = token.attrGet('src');
    const src = typeof srcAttr === 'string' ? srcAttr : '';
    const alt = token.content || '';

    // Handle excalidraw files
    if (
      src.endsWith('.excalidraw') ||
      src.endsWith('.excalidraw.png') ||
      src.endsWith('.excalidraw.svg')
    ) {
      const resolvedSrc = resolveImageSrc(src);
      return `<div class="excalidraw-container"><img src="${resolvedSrc}" alt="${md.utils.escapeHtml(alt)}" class="excalidraw-diagram"></div>`;
    }

    // Resolve local image paths
    const resolvedSrc = resolveImageSrc(src);
    token.attrSet('src', resolvedSrc);
    if (decorateImageToken) {
      decorateImageToken(token);
    }

    return defaultImageRender(tokens, idx, options, env, self);
  };

  addRawHtmlImageRewrites(md, resolveImageSrc);
}

// Raw-HTML image tags bypass the image rule above: they arrive as
// html_block/html_inline tokens emitted verbatim. Rewriting at this
// boundary sees document structure — code tokens (fence, code_block,
// code_inline) never reach these rules — and the tag pattern reads
// quoted attributes, so a '>' inside a value no longer truncates the
// match the way the old post-render regex did.
function addRawHtmlImageRewrites(
  md: MarkdownItInstance,
  resolveImageSrc: (src: string) => string
): void {
  for (const tokenType of ['html_block', 'html_inline']) {
    const defaultRender: RendererRule =
      md.renderer.rules[tokenType] ||
      ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

    md.renderer.rules[tokenType] = (tokens, idx, options, env, self) =>
      rewriteRawHtmlImages(defaultRender(tokens, idx, options, env, self), resolveImageSrc);
  }
}

// Rewrites the src attribute of every complete image tag in a raw-HTML
// fragment through resolveImageSrc. Quoted attribute values may contain '>'.
function rewriteRawHtmlImages(html: string, resolveImageSrc: (src: string) => string): string {
  return html.replace(RAW_HTML_IMAGE_TAG_PATTERN, (tag) =>
    tag.replace(
      RAW_HTML_IMAGE_SRC_PATTERN,
      (_match, boundary, name, quote, src) =>
        `${boundary}${name}${quote}${resolveImageSrc(src)}${quote}`
    )
  );
}

// Re-exported so the compiled dist/markdownCore.js gives the landing generator
// the shared frontmatter helpers and escapeHtml too — its local copies were
// byte-level duplicates of src/utils/frontmatter.ts / src/utils/htmlEscape.ts.
export { parseFrontmatter, renderFrontmatterHtml } from './utils/frontmatter';
export type { FrontmatterResult } from './utils/frontmatter';
export { escapeHtml } from './utils/htmlEscape';
