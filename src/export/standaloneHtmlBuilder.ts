import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { sanitizeExportHtml } from './htmlSanitizer';
import { getNonce, isPathInsideAny } from '../utils/uri';
import { PreviewConfig } from '../types/messages';

export class StandaloneHtmlBuilder {
  constructor(
    private readonly extensionUri: vscode.Uri,
    // The user-visible warning channel for refused assets — injectable so tests
    // can observe it; production wiring is vscode.window.showWarningMessage.
    private readonly warn: (message: string) => void = (message) => {
      void vscode.window.showWarningMessage(message);
    }
  ) {}

  /**
   * Build HTML with vendor scripts for Puppeteer rendering.
   * This includes mermaid.js and katex.js so the headless browser can render them.
   * `features` carries the markdownPreviewPro.enable* flags: a disabled diagram
   * engine emits no diagram blocks, so its vendor runtime is neither read from
   * disk nor embedded in the exported document.
   *
   * The rendered markdown is sanitized BEFORE it is embedded: the markdown
   * engine renders with `html: true`, so raw author markup (scripts, event
   * handlers, iframes) would otherwise reach the headless browser and execute
   * during `page.setContent`. A per-export nonce CSP is defense in depth on
   * top: only the extension's own nonced scripts may run, and no network
   * loads other than images are permitted.
   */
  async buildForBrowser(
    markdownHtml: string,
    title: string,
    documentUri: vscode.Uri,
    features?: Pick<PreviewConfig, 'enableMermaid' | 'enableExcalidraw'>
  ): Promise<string> {
    const nonce = getNonce();
    const enableMermaid = features?.enableMermaid ?? true;
    const enableExcalidraw = features?.enableExcalidraw ?? true;
    const contentSecurityPolicy = [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      "style-src 'unsafe-inline'",
      'img-src data: file: https: http:',
      'font-src data:',
      "connect-src 'none'",
      "media-src 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      "worker-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; ');

    const css = await this.getCombinedCss();
    // Embed local images as data: URIs first (a trusted transform of our own),
    // then sanitize: DOMPurify keeps data: image URIs but strips file-system
    // paths (and would drop Windows-style C:\... srcs), so embedding before
    // sanitizing preserves images across platforms.
    const htmlWithEmbeddedImages = await this.embedImages(markdownHtml, documentUri);
    const sanitizedHtml = await sanitizeExportHtml(htmlWithEmbeddedImages);
    const vendorDir = path.join(this.extensionUri.fsPath, 'dist', 'webview', 'vendor');
    const katexJsPath = path.join(vendorDir, 'katex.min.js');
    const mermaidJsPath = path.join(vendorDir, 'mermaid.min.js');

    const excalidrawJsPath = path.join(vendorDir, 'excalidraw-utils.min.js');

    let katexJs = '';
    let mermaidJs = '';
    let excalidrawJs = '';
    try {
      katexJs = await fs.readFile(katexJsPath, 'utf-8');
    } catch {
      // KaTeX not available
    }
    if (enableMermaid) {
      try {
        mermaidJs = await fs.readFile(mermaidJsPath, 'utf-8');
      } catch {
        // Mermaid not available
      }
    }
    if (enableExcalidraw) {
      try {
        excalidrawJs = await fs.readFile(excalidrawJsPath, 'utf-8');
      } catch {
        // Excalidraw not available
      }
    }

    // Script that renders Mermaid and KaTeX client-side, then signals completion.
    // Nonced so the document CSP allows it while blocking any markup-borne script.
    const renderScript = `
<script nonce="${nonce}">
(async function() {
  // Render KaTeX
  if (typeof katex !== 'undefined') {
    document.querySelectorAll('.katex-inline[data-math]').forEach(function(el) {
      try {
        katex.render(el.getAttribute('data-math'), el, { throwOnError: false, displayMode: false });
      } catch(e) {}
    });
    document.querySelectorAll('.katex-block[data-math]').forEach(function(el) {
      try {
        katex.render(el.getAttribute('data-math'), el, { throwOnError: false, displayMode: true });
      } catch(e) {}
    });
  }

  // Render Mermaid
  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict', layout: 'dagre', look: 'classic' });
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
      } catch(err) {
        block.innerHTML = '<div class="mermaid-error">Diagram error: ' + err.message + '</div>';
        block.setAttribute('data-processed', 'true');
      }
    }
  }

  // Render Excalidraw
  if (typeof ExcalidrawUtils !== 'undefined' && ExcalidrawUtils.exportToSvg) {
    var eBlocks = document.querySelectorAll('.excalidraw-block[data-processed="false"]');
    for (var j = 0; j < eBlocks.length; j++) {
      var eBlock = eBlocks[j];
      var ePre = eBlock.querySelector('pre.excalidraw-source');
      if (!ePre) continue;
      var eJson = ePre.textContent || '';
      try {
        var eData = JSON.parse(eJson);
        if (!eData.elements || !Array.isArray(eData.elements)) {
          throw new Error('Invalid Excalidraw data');
        }
        var eSvg = await ExcalidrawUtils.exportToSvg({
          data: {
            elements: eData.elements,
            appState: Object.assign({
              exportWithDarkMode: false,
              viewBackgroundColor: '#ffffff'
            }, eData.appState || {}),
            files: eData.files || null
          }
        });
        eBlock.innerHTML = '';
        eBlock.appendChild(eSvg);
        eBlock.setAttribute('data-processed', 'true');
        eBlock.classList.add('excalidraw-rendered');
      } catch(err) {
        eBlock.innerHTML = '<div class="excalidraw-error">Diagram error: ' + err.message + '</div>';
        eBlock.setAttribute('data-processed', 'true');
      }
    }
  }

  // Signal completion
  window.__exportRenderComplete = true;
})();
</script>`;

    // A disabled engine's vendor runtime is not embedded at all — its diagram
    // fences rendered as plain code blocks upstream, so nothing references it.
    const vendorScripts = [
      `  <script nonce="${nonce}">${katexJs}</script>`,
      enableMermaid ? `  <script nonce="${nonce}">${mermaidJs}</script>` : '',
      enableExcalidraw ? `  <script nonce="${nonce}">${excalidrawJs}</script>` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>
  <style>
${css}
  </style>
${vendorScripts}
</head>
<body>
  <div id="preview-content">
${sanitizedHtml}
  </div>
  ${renderScript}
</body>
</html>`;
  }

  private async getCombinedCss(): Promise<string> {
    const parts: string[] = [];

    // Read vendor CSS
    const vendorDir = path.join(this.extensionUri.fsPath, 'dist', 'webview', 'vendor');
    for (const file of ['katex.min.css']) {
      try {
        const css = await fs.readFile(path.join(vendorDir, file), 'utf-8');
        parts.push(`/* ${file} */\n${css}`);
      } catch {
        // Vendor file not available
      }
    }

    // Read bundled main.css (contains all webview styles)
    const mainCssPath = path.join(this.extensionUri.fsPath, 'dist', 'webview', 'main.css');
    try {
      const css = await fs.readFile(mainCssPath, 'utf-8');
      parts.push(`/* main.css */\n${css}`);
    } catch {
      // Fall back to reading source CSS files
      const stylesDir = path.join(this.extensionUri.fsPath, 'webview', 'styles');
      for (const file of [
        'main.css',
        'markdown.css',
        'code.css',
        'mermaid.css',
        'excalidraw.css',
        'highlight.css',
      ]) {
        try {
          const css = await fs.readFile(path.join(stylesDir, file), 'utf-8');
          parts.push(`/* ${file} */\n${css}`);
        } catch {
          // Style file not available
        }
      }
    }

    // Embed KaTeX fonts as base64
    const fontsDir = path.join(vendorDir, 'fonts');
    let combined = parts.join('\n\n');
    combined = await this.embedFonts(combined, fontsDir);

    // Replace VS Code theme variables with sensible defaults for standalone
    combined = this.replaceThemeVariables(combined);

    return combined;
  }

  private async embedFonts(css: string, fontsDir: string): Promise<string> {
    // Replace url(fonts/...) references with base64 data URIs
    const fontUrlRegex = /url\((?:['"]?)(?:\.\/)?fonts\/([^'")\s]+)(?:['"]?)\)/g;
    const matches = [...css.matchAll(fontUrlRegex)];

    for (const match of matches) {
      const fontFile = match[1];
      const fontPath = path.join(fontsDir, fontFile);
      try {
        const fontData = await fs.readFile(fontPath);
        const ext = path.extname(fontFile).slice(1);
        const mimeType = this.getFontMimeType(ext);
        const base64 = fontData.toString('base64');
        css = css.replace(match[0], `url(data:${mimeType};base64,${base64})`);
      } catch {
        // Font not available, leave reference as-is
      }
    }

    return css;
  }

  private replaceThemeVariables(css: string): string {
    // Provide default values for VS Code theme variables in standalone context
    // For PDF/print exports, we use black text for better readability and contrast
    const defaults: Record<string, string> = {
      '--vscode-editor-background': '#ffffff',
      '--vscode-editor-foreground': '#000000',
      '--vscode-descriptionForeground': '#333333',
      '--vscode-editorWidget-border': 'rgba(0, 0, 0, 0.2)',
      '--vscode-editorCursor-foreground': '#0066cc',
      '--vscode-textCodeBlock-background': '#f5f5f5',
      '--vscode-textLink-foreground': '#0000cc',
      '--vscode-textLink-activeForeground': '#0000cc',
      '--vscode-editor-selectionBackground': 'rgba(200, 220, 255, 0.5)',
      '--vscode-list-hoverBackground': 'rgba(0, 0, 0, 0.05)',
      '--vscode-panel-background': '#ffffff',
      '--vscode-input-background': 'rgba(0, 0, 0, 0.05)',
      '--vscode-button-background': '#0066cc',
      '--vscode-button-foreground': '#ffffff',
      '--vscode-button-hoverBackground': '#0052a3',
      '--vscode-scrollbarSlider-background': 'rgba(0, 0, 0, 0.3)',
      '--vscode-scrollbarSlider-hoverBackground': 'rgba(0, 0, 0, 0.5)',
      '--vscode-scrollbarSlider-activeBackground': 'rgba(0, 0, 0, 0.7)',
      '--vscode-errorForeground': '#cc0000',
      '--vscode-inputValidation-errorBackground': 'rgba(255, 0, 0, 0.1)',
      '--vscode-inputValidation-errorBorder': '#cc0000',
      '--vscode-editor-font-family': "'SF Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace",
    };

    // Prepend :root block with default values
    const rootBlock = Object.entries(defaults)
      .map(([key, value]) => `  ${key}: ${value};`)
      .join('\n');

    return `/* Print/PDF export theme defaults - optimized for readability */\n:root {\n${rootBlock}\n}\n\n${css}`;
  }

  /**
   * The directories a local image may legitimately be read from during export:
   * the document's own directory plus every workspace folder, so a
   * workspace-relative reference like `../assets/x.png` still resolves while
   * anything further afield is refused.
   */
  private getImageResourceRoots(documentUri: vscode.Uri): string[] {
    const docDir = path.dirname(documentUri.fsPath);
    const workspaceDirs = (vscode.workspace.workspaceFolders ?? []).map(
      (folder) => folder.uri.fsPath
    );
    return [docDir, ...workspaceDirs];
  }

  private async embedImages(
    html: string,
    documentUri: vscode.Uri,
    allowedRoots?: string[]
  ): Promise<string> {
    const docDir = path.dirname(documentUri.fsPath);
    const roots = allowedRoots ?? this.getImageResourceRoots(documentUri);
    const imgRegex = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/g;
    const matches = [...html.matchAll(imgRegex)];
    const refused: string[] = [];

    // Resolve each matched tag's image to a data URI first, keyed by the tag's
    // offset in the document. The src string alone is not a safe String.replace
    // needle: it can repeat across tags or appear in prose, and the first
    // textual occurrence is not necessarily the tag that produced it.
    const dataUriByOffset = new Map<number, string>();
    for (const match of matches) {
      const src = match[1];

      // Skip data URIs and HTTP URLs
      if (src.startsWith('data:') || /^https?:\/\//.test(src)) {
        continue;
      }

      // Resolve to actual file path
      let filePath: string;
      if (src.startsWith('https://file+.vscode-resource.vscode-cdn.net/')) {
        filePath = decodeURIComponent(
          src.replace('https://file+.vscode-resource.vscode-cdn.net', '')
        );
      } else {
        filePath = path.resolve(docDir, src);
      }

      // Prevent path traversal outside the document directory and workspace —
      // a real containment check, not a startsWith prefix match that admits
      // sibling directories like /home/u/notes-private.
      if (!isPathInsideAny(filePath, roots)) {
        refused.push(src);
        continue;
      }

      try {
        const imageData = await fs.readFile(filePath);
        const ext = path.extname(filePath).slice(1).toLowerCase();
        const mimeType = this.getImageMimeType(ext);
        const base64 = imageData.toString('base64');
        dataUriByOffset.set(match.index ?? -1, `data:${mimeType};base64,${base64}`);
      } catch {
        // Image not found, leave original src
      }
    }

    // Single pass: each matched tag rewrites only its own src attribute.
    const result = html.replace(imgRegex, (tag: string, _src: string, offset: number) => {
      const dataUri = dataUriByOffset.get(offset);
      if (dataUri === undefined) {
        return tag;
      }
      return tag.replace(
        /(\ssrc=)(["'])[^"']*\2/,
        (_m: string, prefix: string, quote: string) => `${prefix}${quote}${dataUri}${quote}`
      );
    });

    if (refused.length > 0) {
      const shown = refused.slice(0, 3);
      const remainder = refused.length - shown.length;
      this.warn(
        `Markdown Preview Pro: skipped ${refused.length} image(s) outside the ` +
          `document/workspace folders: ${shown.join(', ')}` +
          `${remainder > 0 ? ` and ${remainder} more` : ''}`
      );
    }

    return result;
  }

  private getFontMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      woff2: 'font/woff2',
      woff: 'font/woff',
      ttf: 'font/ttf',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  private getImageMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',
      bmp: 'image/bmp',
      ico: 'image/x-icon',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
