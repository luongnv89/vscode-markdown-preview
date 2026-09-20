import * as vscode from 'vscode';
import { getNonce } from './uri';

/**
 * Extension metadata displayed by the webview's About popup.
 * Values come from package.json (and git); they are escaped before they are
 * interpolated into the webview document.
 */
export interface PreviewAboutInfo {
  version: string;
  publisher: string;
  repo: string;
  commit: string;
}

/**
 * The slice of `vscode.Webview` the HTML builder needs. Declared as a narrow
 * structural interface so tests can substitute a plain stub.
 */
export interface WebviewResourceSource {
  readonly cspSource: string;
  asWebviewUri(uri: vscode.Uri): vscode.Uri;
}

/**
 * Escape a value for interpolation into a double-quoted HTML attribute
 * (`<body data-version="...">`). Escaping `&`, `<`, `>`, `"` and `'` keeps a
 * hostile value from terminating the attribute or opening a new element — the
 * `<body data-*>` values are read back by the webview via `dataset`.
 */
export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the webview HTML document.
 *
 * CSP notes:
 * - `script-src` is nonce-only. Mermaid 11.x (vendored in dist/webview/vendor)
 *   renders without `eval`/`new Function` under `securityLevel: 'strict'`, so
 *   `'unsafe-eval'` is intentionally absent (verified in headless Chromium).
 * - `img-src` is the webview scheme plus `data:` for embedded images. Remote
 *   `https:` images are blocked by default (a document could otherwise beacon
 *   its open + the viewer's IP); the documented opt-in
 *   `markdownPreviewPro.allowRemoteImages` re-adds `https:`, mirroring the
 *   remote-content opt-in of VS Code's built-in markdown preview.
 * - Vendor `<script>` tags follow the feature flags: mermaid.min.js and
 *   excalidraw-utils.min.js make up most of the ~4.86 MB per-preview vendor
 *   payload, so `enableMermaid`/`enableExcalidraw` off omits the tag entirely.
 *   `script-src` is nonce-only either way, so a shorter list needs no CSP
 *   change — every emitted tag still carries the nonce.
 */
export function buildWebviewHtml(
  webview: WebviewResourceSource,
  extensionUri: vscode.Uri,
  aboutInfo: PreviewAboutInfo,
  allowRemoteImages: boolean,
  enableMermaid = true,
  enableExcalidraw = true
): string {
  const nonce = getNonce();

  const vendorUri = vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'vendor');
  const mainScript = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'main.js')
  );
  const mainStyle = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'main.css')
  );
  const katexStyle = webview.asWebviewUri(vscode.Uri.joinPath(vendorUri, 'katex.min.css'));
  const katexScript = webview.asWebviewUri(vscode.Uri.joinPath(vendorUri, 'katex.min.js'));
  const mermaidScript = webview.asWebviewUri(vscode.Uri.joinPath(vendorUri, 'mermaid.min.js'));
  const excalidrawScript = webview.asWebviewUri(
    vscode.Uri.joinPath(vendorUri, 'excalidraw-utils.min.js')
  );

  const imgSrc = allowRemoteImages
    ? `img-src ${webview.cspSource} https: data:`
    : `img-src ${webview.cspSource} data:`;

  // Emit a vendor <script> only for enabled features — a disabled diagram
  // engine never needs its multi-MB runtime in the preview document.
  const scriptUris = [katexScript];
  if (enableMermaid) {
    scriptUris.push(mermaidScript);
  }
  if (enableExcalidraw) {
    scriptUris.push(excalidrawScript);
  }
  scriptUris.push(mainScript);
  const scriptTags = scriptUris
    .map((src) => `  <script nonce="${nonce}" src="${src}"></script>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
      script-src 'nonce-${nonce}';
      style-src ${webview.cspSource} 'unsafe-inline';
      ${imgSrc};
      font-src ${webview.cspSource};
      connect-src ${webview.cspSource};
      worker-src 'none';
      frame-src 'none';">
  <link rel="stylesheet" href="${katexStyle}">
  <link rel="stylesheet" href="${mainStyle}">
  <title>Markdown Preview Pro</title>
</head>
<body data-version="${escapeHtmlAttr(aboutInfo.version)}" data-commit="${escapeHtmlAttr(aboutInfo.commit)}" data-publisher="${escapeHtmlAttr(aboutInfo.publisher)}" data-repo="${escapeHtmlAttr(aboutInfo.repo)}">
  <div id="preview-content"></div>
${scriptTags}
</body>
</html>`;
}
