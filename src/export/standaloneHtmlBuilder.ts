import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { sanitizeExportHtml } from './htmlSanitizer';
import { escapeHtml } from '../utils/htmlEscape';
import { getNonce, isPathInsideAny } from '../utils/uri';
import { PreviewConfig } from '../types/messages';

// Per-export CSP for the standalone document: only the extension's own nonced
// scripts may run, and no network loads other than images are permitted.
function buildExportContentSecurityPolicy(nonce: string): string {
  return [
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
}

// Everything after the `<script nonce="...">` line of the render script —
// hoisted out of buildForBrowser so the giant client-side template lives as a
// module constant. Concatenated at the call site, so the emitted markup is
// byte-identical to the former inline literal.
const EXPORT_RENDER_SCRIPT_BODY = `
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

// Script that renders Mermaid and KaTeX client-side, then signals completion.
// Nonced so the document CSP allows it while blocking any markup-borne script.
function buildRenderScript(nonce: string): string {
  return `\n<script nonce="${nonce}">${EXPORT_RENDER_SCRIPT_BODY}`;
}

interface VendorScriptContents {
  katexJs: string;
  mermaidJs: string;
  excalidrawJs: string;
}

// Feature flags that can force a renderer off even when its placeholder
// markup is present — a disabled engine emits no placeholders upstream
// (markdownCore.ts), so the flag check is defense in depth, not the gate.
type ExportFeatureFlags = Partial<
  Pick<PreviewConfig, 'enableKatex' | 'enableMermaid' | 'enableExcalidraw'>
>;

// Which client-side runtimes the exported document actually uses. Each
// renderer's vendor bundle (~26 MB combined) is read from disk and inlined
// only when the document carries its placeholder markup; KaTeX additionally
// gates its stylesheet and the base64 font embedding (~1.4 MB of output).
interface ExportAssetNeeds {
  math: boolean;
  mermaid: boolean;
  excalidraw: boolean;
}

// Detection runs on the sanitized markup — post-DOMPurify — so it counts
// exactly the placeholders the render script will find. The match requires a
// class attribute (`class="…katex-block…"`), so prose merely mentioning a
// class name cannot trigger an embed; the classes are the same selectors the
// render script queries (`.katex-inline[data-math]`, `.mermaid-block`,
// `.excalidraw-block`).
function detectExportAssetNeeds(
  sanitizedHtml: string,
  features: Required<ExportFeatureFlags>
): ExportAssetNeeds {
  return {
    math: features.enableKatex && /class="[^"]*\bkatex-(?:inline|block)\b/.test(sanitizedHtml),
    mermaid: features.enableMermaid && /class="[^"]*\bmermaid-block\b/.test(sanitizedHtml),
    excalidraw: features.enableExcalidraw && /class="[^"]*\bexcalidraw-block\b/.test(sanitizedHtml),
  };
}

// A runtime the document does not reference is not embedded at all — its
// fences rendered as plain code blocks, or no such fences exist.
function buildVendorScriptTags(
  nonce: string,
  scripts: VendorScriptContents,
  needs: ExportAssetNeeds
): string {
  return [
    needs.math ? `  <script nonce="${nonce}">${scripts.katexJs}</script>` : '',
    needs.mermaid ? `  <script nonce="${nonce}">${scripts.mermaidJs}</script>` : '',
    needs.excalidraw ? `  <script nonce="${nonce}">${scripts.excalidrawJs}</script>` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export class StandaloneHtmlBuilder {
  constructor(
    private readonly extensionUri: vscode.Uri,
    // The user-visible warning channel for refused assets — injectable so tests
    // can observe it; production wiring is vscode.window.showWarningMessage.
    private readonly warn: (message: string) => void = (message) => {
      void vscode.window.showWarningMessage(message);
    },
    // Injectable so tests can observe which files an export actually reads —
    // asset gating must skip the disk read, not just the embed. Defaults to
    // the real fs.promises.readFile (Buffer form; text callers decode).
    private readonly readFile: (filePath: string) => Promise<Buffer> = (filePath) =>
      fs.readFile(filePath)
  ) {}

  /**
   * Build HTML with vendor scripts for Puppeteer rendering.
   * Only the runtimes the rendered document actually uses are read and
   * inlined: a document with no math gets no KaTeX script, stylesheet or
   * embedded fonts, and a document with no mermaid/excalidraw blocks gets
   * neither diagram bundle. `features` carries the markdownPreviewPro.enable*
   * flags as a second gate: a disabled engine emits no placeholders upstream,
   * and its vendor runtime is never embedded even if markup claims otherwise.
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
    features?: ExportFeatureFlags
  ): Promise<string> {
    const nonce = getNonce();
    const flags: Required<ExportFeatureFlags> = {
      enableKatex: features?.enableKatex ?? true,
      enableMermaid: features?.enableMermaid ?? true,
      enableExcalidraw: features?.enableExcalidraw ?? true,
    };
    const contentSecurityPolicy = buildExportContentSecurityPolicy(nonce);

    // Embed local images as data: URIs first (a trusted transform of our own),
    // then sanitize: DOMPurify keeps data: image URIs but strips file-system
    // paths (and would drop Windows-style C:\... srcs), so embedding before
    // sanitizing preserves images across platforms.
    const htmlWithEmbeddedImages = await this.embedImages(markdownHtml, documentUri);
    const sanitizedHtml = await sanitizeExportHtml(htmlWithEmbeddedImages);
    // Content gating happens on the sanitized markup: it is exactly what the
    // headless browser will render, so a placeholder that would not survive
    // sanitization never triggers an asset embed.
    const needs = detectExportAssetNeeds(sanitizedHtml, flags);

    const css = await this.getCombinedCss(needs.math);
    const vendorJs = await this.readVendorScripts(needs);
    const renderScript = buildRenderScript(nonce);
    const vendorScripts = buildVendorScriptTags(nonce, vendorJs, needs);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
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

  // Read the vendor runtimes the export embeds — a runtime the document does
  // not use is never opened, and every read failure degrades to an empty
  // string so the export still completes without that runtime.
  private async readVendorScripts(needs: ExportAssetNeeds): Promise<VendorScriptContents> {
    const vendorDir = path.join(this.extensionUri.fsPath, 'dist', 'webview', 'vendor');
    let katexJs = '';
    let mermaidJs = '';
    let excalidrawJs = '';
    if (needs.math) {
      try {
        katexJs = (await this.readFile(path.join(vendorDir, 'katex.min.js'))).toString('utf-8');
      } catch {
        // KaTeX not available
      }
    }
    if (needs.mermaid) {
      try {
        mermaidJs = (await this.readFile(path.join(vendorDir, 'mermaid.min.js'))).toString('utf-8');
      } catch {
        // Mermaid not available
      }
    }
    if (needs.excalidraw) {
      try {
        excalidrawJs = (
          await this.readFile(path.join(vendorDir, 'excalidraw-utils.min.js'))
        ).toString('utf-8');
      } catch {
        // Excalidraw not available
      }
    }
    return { katexJs, mermaidJs, excalidrawJs };
  }

  private async getCombinedCss(includeKatexAssets: boolean): Promise<string> {
    const parts: string[] = [];

    // KaTeX's stylesheet ships the @font-face rules whose url(fonts/…) refs
    // embedFonts inlines — without math in the document, neither the CSS nor
    // the ~1.4 MB of base64 font data is needed.
    const vendorDir = path.join(this.extensionUri.fsPath, 'dist', 'webview', 'vendor');
    if (includeKatexAssets) {
      for (const file of ['katex.min.css']) {
        try {
          const css = (await this.readFile(path.join(vendorDir, file))).toString('utf-8');
          parts.push(`/* ${file} */\n${css}`);
        } catch {
          // Vendor file not available
        }
      }
    }

    await this.pushMainCss(parts);

    let combined = parts.join('\n\n');
    // url(fonts/…) references only ever come from katex.min.css, so the font
    // embedding is gated on the same flag that included that stylesheet.
    if (includeKatexAssets) {
      const fontsDir = path.join(vendorDir, 'fonts');
      combined = await this.embedFonts(combined, fontsDir);
    }

    // Replace VS Code theme variables with sensible defaults for standalone
    combined = this.replaceThemeVariables(combined);

    return combined;
  }

  // Bundled main.css carries all webview styles; when the webpack output is
  // absent the source stylesheets are the fallback.
  private async pushMainCss(parts: string[]): Promise<void> {
    const mainCssPath = path.join(this.extensionUri.fsPath, 'dist', 'webview', 'main.css');
    try {
      const css = (await this.readFile(mainCssPath)).toString('utf-8');
      parts.push(`/* main.css */\n${css}`);
      return;
    } catch {
      // Fall back to reading source CSS files
    }
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
        const css = (await this.readFile(path.join(stylesDir, file))).toString('utf-8');
        parts.push(`/* ${file} */\n${css}`);
      } catch {
        // Style file not available
      }
    }
  }

  private async embedFonts(css: string, fontsDir: string): Promise<string> {
    // Replace url(fonts/...) references with base64 data URIs
    const fontUrlRegex = /url\((?:['"]?)(?:\.\/)?fonts\/([^'")\s]+)(?:['"]?)\)/g;
    const matches = [...css.matchAll(fontUrlRegex)];

    for (const match of matches) {
      const fontFile = match[1];
      const fontPath = path.join(fontsDir, fontFile);
      try {
        const fontData = await this.readFile(fontPath);
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

    const { dataUriByOffset, refused } = await this.collectImageDataUris(matches, docDir, roots);

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

    this.warnAboutRefusedImages(refused);
    return result;
  }

  // Resolve each matched tag's image to a data URI first, keyed by the tag's
  // offset in the document. The src string alone is not a safe String.replace
  // needle: it can repeat across tags or appear in prose, and the first
  // textual occurrence is not necessarily the tag that produced it.
  private async collectImageDataUris(
    matches: RegExpMatchArray[],
    docDir: string,
    roots: string[]
  ): Promise<{ dataUriByOffset: Map<number, string>; refused: string[] }> {
    const dataUriByOffset = new Map<number, string>();
    const refused: string[] = [];
    for (const match of matches) {
      const src = match[1];

      // Skip data URIs and HTTP URLs
      if (src.startsWith('data:') || /^https?:\/\//.test(src)) {
        continue;
      }

      const filePath = this.resolveImageFilePath(src, docDir);

      // Prevent path traversal outside the document directory and workspace —
      // a real containment check, not a startsWith prefix match that admits
      // sibling directories like /home/u/notes-private.
      if (!isPathInsideAny(filePath, roots)) {
        refused.push(src);
        continue;
      }

      try {
        const imageData = await this.readFile(filePath);
        const ext = path.extname(filePath).slice(1).toLowerCase();
        const mimeType = this.getImageMimeType(ext);
        const base64 = imageData.toString('base64');
        dataUriByOffset.set(match.index ?? -1, `data:${mimeType};base64,${base64}`);
      } catch {
        // Image not found, leave original src
      }
    }
    return { dataUriByOffset, refused };
  }

  // Decode the CDN-rewritten resource scheme, otherwise resolve against the
  // document's own directory.
  private resolveImageFilePath(src: string, docDir: string): string {
    if (src.startsWith('https://file+.vscode-resource.vscode-cdn.net/')) {
      return decodeURIComponent(src.replace('https://file+.vscode-resource.vscode-cdn.net', ''));
    }
    return path.resolve(docDir, src);
  }

  private warnAboutRefusedImages(refused: string[]): void {
    if (refused.length === 0) {
      return;
    }
    const shown = refused.slice(0, 3);
    const remainder = refused.length - shown.length;
    this.warn(
      `Markdown Preview Pro: skipped ${refused.length} image(s) outside the ` +
        `document/workspace folders: ${shown.join(', ')}` +
        `${remainder > 0 ? ` and ${remainder} more` : ''}`
    );
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
}
