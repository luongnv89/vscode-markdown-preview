import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import * as vscode from 'vscode';
import { PreviewConfig } from './types/messages';
import { resolveImageUri } from './utils/uri';

export interface RenderResult {
  html: string;
}

export class MarkdownEngine {
  private md: MarkdownIt;
  private config: PreviewConfig;
  private documentUri: vscode.Uri | undefined;
  private webview: vscode.Webview | undefined;

  constructor(config: PreviewConfig) {
    this.config = config;
    this.md = this.createEngine(config);
  }

  private createEngine(config: PreviewConfig): MarkdownIt {
    const md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: config.typographer,
      breaks: config.lineBreaks,
      highlight: (str: string, lang: string): string => {
        if (lang && lang !== 'mermaid' && hljs.getLanguage(lang)) {
          try {
            const result = hljs.highlight(str, { language: lang, ignoreIllegals: true });
            return `<pre class="hljs code-block" data-lang="${lang}"><code>${result.value}</code></pre>`;
          } catch {
            // Fall through to default
          }
        }
        if (lang === 'mermaid') {
          return `<div class="mermaid-block" data-processed="false"><pre class="mermaid">${md.utils.escapeHtml(str)}</pre></div>`;
        }
        // Auto-detect
        const escaped = md.utils.escapeHtml(str);
        return `<pre class="hljs code-block"><code>${escaped}</code></pre>`;
      },
    });

    // Add line number data attributes to block-level elements
    this.addLineNumbers(md);

    // Task list support
    if (config.enableCheckboxes) {
      this.addTaskListSupport(md);
    }

    // KaTeX support
    if (config.enableKatex) {
      this.addKatexSupport(md);
    }

    // Custom image rendering for local images
    this.addImageSupport(md);

    return md;
  }

  private addLineNumbers(md: MarkdownIt): void {
    // Add data-line to block-level opening tokens
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
        ((tokens: any, idx: any, options: any, env: any, self: any) =>
          self.renderToken(tokens, idx, options));

      md.renderer.rules[tokenType] = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        if (token.map && token.map.length >= 1) {
          token.attrSet('data-line', String(token.map[0]));
          token.attrJoin('class', 'code-line');
        }
        return defaultRender(tokens, idx, options, env, self);
      };
    }

    // Special handling for list items (for checkbox support)
    const defaultListItemRender =
      md.renderer.rules['list_item_open'] ||
      ((tokens: any, idx: any, options: any, env: any, self: any) =>
        self.renderToken(tokens, idx, options));

    md.renderer.rules['list_item_open'] = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      if (token.map && token.map.length >= 1) {
        token.attrSet('data-line', String(token.map[0]));
      }
      return defaultListItemRender(tokens, idx, options, env, self);
    };
  }

  private addTaskListSupport(md: MarkdownIt): void {
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

  private addKatexSupport(md: MarkdownIt): void {
    // Inline math: $...$
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

    md.renderer.rules['math_inline'] = (tokens, idx) => {
      return `<span class="katex-inline" data-math="${md.utils.escapeHtml(tokens[idx].content)}">${md.utils.escapeHtml(tokens[idx].content)}</span>`;
    };

    // Block math: $$...$$
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

    md.renderer.rules['math_block'] = (tokens, idx) => {
      const line = tokens[idx].map ? tokens[idx].map![0] : 0;
      return `<div class="katex-block code-line" data-line="${line}" data-math="${md.utils.escapeHtml(tokens[idx].content)}">${md.utils.escapeHtml(tokens[idx].content)}</div>\n`;
    };
  }

  private addImageSupport(md: MarkdownIt): void {
    const defaultImageRender =
      md.renderer.rules.image ||
      ((tokens: any, idx: any, options: any, env: any, self: any) =>
        self.renderToken(tokens, idx, options));

    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const src = token.attrGet('src') || '';
      const alt = token.content || '';

      // Handle excalidraw files
      if (
        src.endsWith('.excalidraw') ||
        src.endsWith('.excalidraw.png') ||
        src.endsWith('.excalidraw.svg')
      ) {
        const resolvedSrc = this.resolveUri(src);
        return `<div class="excalidraw-container"><img src="${resolvedSrc}" alt="${md.utils.escapeHtml(alt)}" class="excalidraw-diagram"></div>`;
      }

      // Resolve local image paths
      const resolvedSrc = this.resolveUri(src);
      token.attrSet('src', resolvedSrc);

      return defaultImageRender(tokens, idx, options, env, self);
    };
  }

  private resolveUri(src: string): string {
    if (this.documentUri) {
      return resolveImageUri(src, this.documentUri, this.webview);
    }
    return src;
  }

  public setContext(documentUri: vscode.Uri, webview: vscode.Webview): void {
    this.documentUri = documentUri;
    this.webview = webview;
  }

  public setExportContext(documentUri: vscode.Uri): void {
    this.documentUri = documentUri;
    this.webview = undefined;
  }

  public updateConfig(config: PreviewConfig): void {
    this.config = config;
    this.md = this.createEngine(config);
  }

  public render(content: string): RenderResult {
    let html = this.md.render(content);

    // Post-process: resolve image src attributes in raw HTML blocks/inlines
    // that bypass the markdown-it image renderer rule (e.g. <img src="...">).
    html = html.replace(
      /(<img\s[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi,
      (_match, prefix, quote, src) => {
        const resolved = this.resolveUri(src);
        return `${prefix}${quote}${resolved}${quote}`;
      }
    );

    return { html };
  }
}
