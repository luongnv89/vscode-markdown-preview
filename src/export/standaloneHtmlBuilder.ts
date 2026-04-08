import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

export class StandaloneHtmlBuilder {
  constructor(private readonly extensionUri: vscode.Uri) {}

  /**
   * Build HTML with vendor scripts for Puppeteer rendering.
   * This includes mermaid.js and katex.js so the headless browser can render them.
   */
  async buildForBrowser(
    markdownHtml: string,
    title: string,
    documentUri: vscode.Uri
  ): Promise<string> {
    const css = await this.getCombinedCss();
    const htmlWithEmbeddedImages = await this.embedImages(markdownHtml, documentUri);
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
    try {
      mermaidJs = await fs.readFile(mermaidJsPath, 'utf-8');
    } catch {
      // Mermaid not available
    }
    try {
      excalidrawJs = await fs.readFile(excalidrawJsPath, 'utf-8');
    } catch {
      // Excalidraw not available
    }

    // Script that renders Mermaid and KaTeX client-side, then signals completion
    const renderScript = `
<script>
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
          elements: eData.elements,
          appState: Object.assign({
            exportWithDarkMode: false,
            viewBackgroundColor: '#ffffff'
          }, eData.appState || {}),
          files: eData.files || {}
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

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>
  <style>
${css}
  </style>
  <script>${katexJs}</script>
  <script>${mermaidJs}</script>
  <script>${excalidrawJs}</script>
</head>
<body class="vscode-light">
  <div id="preview-content">
${htmlWithEmbeddedImages}
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
    // Provide light-theme defaults for VS Code variables — exports use light mode
    // for better print contrast. Body class "vscode-light" activates the matching
    // hljs token-color rules in code.css.
    const defaults: Record<string, string> = {
      '--vscode-editor-background': '#ffffff',
      '--vscode-editor-foreground': '#24292e',
      '--vscode-descriptionForeground': '#656d76',
      '--vscode-editorWidget-border': '#d0d7de',
      '--vscode-editorCursor-foreground': '#0969da',
      '--vscode-textCodeBlock-background': '#f6f8fa',
      '--vscode-textLink-foreground': '#0969da',
      '--vscode-textLink-activeForeground': '#0969da',
      '--vscode-editor-selectionBackground': 'rgba(9, 105, 218, 0.2)',
      '--vscode-list-hoverBackground': 'rgba(208, 215, 222, 0.32)',
      '--vscode-panel-background': '#f6f8fa',
      '--vscode-input-background': '#ffffff',
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

    // Prepend :root block with default values
    const rootBlock = Object.entries(defaults)
      .map(([key, value]) => `  ${key}: ${value};`)
      .join('\n');

    return `/* Standalone theme defaults */\n:root {\n${rootBlock}\n}\n\n${css}`;
  }

  private async embedImages(html: string, documentUri: vscode.Uri): Promise<string> {
    const docDir = path.dirname(documentUri.fsPath);
    const imgRegex = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/g;
    const matches = [...html.matchAll(imgRegex)];

    let result = html;
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

      // Prevent path traversal outside the document directory
      if (!filePath.startsWith(docDir)) {
        continue;
      }

      try {
        const imageData = await fs.readFile(filePath);
        const ext = path.extname(filePath).slice(1).toLowerCase();
        const mimeType = this.getImageMimeType(ext);
        const base64 = imageData.toString('base64');
        const dataUri = `data:${mimeType};base64,${base64}`;
        result = result.replace(match[1], dataUri);
      } catch {
        // Image not found, leave original src
      }
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
