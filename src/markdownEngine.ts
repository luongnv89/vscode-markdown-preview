import * as vscode from 'vscode';
import { PreviewConfig } from './types/messages';
import { resolveImageUri } from './utils/uri';
import { parseFrontmatter, renderFrontmatterHtml } from './utils/frontmatter';
import { createMarkdownIt, MarkdownItInstance } from './markdownCore';

// The shared markdown-it pipeline (fence highlighting, data-line attributes,
// task lists, KaTeX math, image rules) lives in ./markdownCore — vscode-free so
// the landing generator consumes the same engine via dist/markdownCore.js.
// This class adds the vscode seam: document/webview-aware image resolution and
// frontmatter composition.

export interface RenderResult {
  html: string;
}

export class MarkdownEngine {
  private md: MarkdownItInstance;
  private config: PreviewConfig;
  private documentUri: vscode.Uri | undefined;
  private webview: vscode.Webview | undefined;

  constructor(config: PreviewConfig) {
    this.config = config;
    this.md = this.createEngine(config);
  }

  private createEngine(config: PreviewConfig): MarkdownItInstance {
    return createMarkdownIt(config, {
      resolveImageSrc: (src) => this.resolveUri(src),
    });
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
    let body = content;
    let frontmatterHtml = '';
    let linesConsumed = 0;

    if (this.config.showFrontmatter === 'card') {
      const result = parseFrontmatter(content);
      body = result.body;
      linesConsumed = result.linesConsumed;
      if (result.frontmatter) {
        // Badge paths resolve at construction — the card markup never goes
        // through the markdown-it renderer rules.
        frontmatterHtml = renderFrontmatterHtml(result.frontmatter, (src) => this.resolveUri(src));
      }
    }

    // The frontmatter offset is applied to token maps during the token pass
    // (see addLineNumbers in markdownCore), so no data-line rewrite of the
    // rendered HTML — and no accidental renumbering of literal data-line
    // text — is needed here.
    const html = frontmatterHtml + this.md.render(body, { lineOffset: linesConsumed });

    return { html };
  }
}
