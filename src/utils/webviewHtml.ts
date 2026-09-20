import * as vscode from 'vscode';
import { escapeHtml } from './htmlEscape';
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
 *
 * Delegates to the shared escapeHtml for the core four and adds `'` on top —
 * the attribute escaper is a superset, not a second implementation (issue #55).
 */
export const escapeHtmlAttr = (value: string): string => escapeHtml(value).replace(/'/g, '&#39;');

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
  const assetUris = resolveWebviewAssetUris(webview, extensionUri);
  const { katexStyle, mainStyle } = assetUris;

  const imgSrc = allowRemoteImages
    ? `img-src ${webview.cspSource} https: data:`
    : `img-src ${webview.cspSource} data:`;

  const scriptTags = buildScriptTags(nonce, assetUris, enableMermaid, enableExcalidraw);

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
  <div id="preview-content"><div class="preview-placeholder" role="status" aria-live="polite">
    <div class="preview-placeholder-title">Rendering preview&#8230;</div>
    <div class="preview-placeholder-skeleton"></div>
    <div class="preview-placeholder-skeleton"></div>
    <div class="preview-placeholder-skeleton preview-placeholder-short"></div>
  </div></div>
${scriptTags}
</body>
</html>`;
}

/**
 * The webview URIs the document template interpolates — bundle assets plus the
 * per-feature vendor runtimes.
 */
interface WebviewAssetUris {
  mainScript: vscode.Uri;
  mainStyle: vscode.Uri;
  katexStyle: vscode.Uri;
  katexScript: vscode.Uri;
  mermaidScript: vscode.Uri;
  excalidrawScript: vscode.Uri;
}

function resolveWebviewAssetUris(
  webview: WebviewResourceSource,
  extensionUri: vscode.Uri
): WebviewAssetUris {
  const vendorUri = vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'vendor');
  return {
    mainScript: webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'main.js')
    ),
    mainStyle: webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'main.css')
    ),
    katexStyle: webview.asWebviewUri(vscode.Uri.joinPath(vendorUri, 'katex.min.css')),
    katexScript: webview.asWebviewUri(vscode.Uri.joinPath(vendorUri, 'katex.min.js')),
    mermaidScript: webview.asWebviewUri(vscode.Uri.joinPath(vendorUri, 'mermaid.min.js')),
    excalidrawScript: webview.asWebviewUri(
      vscode.Uri.joinPath(vendorUri, 'excalidraw-utils.min.js')
    ),
  };
}

/**
 * Emit a vendor <script> only for enabled features — a disabled diagram
 * engine never needs its multi-MB runtime in the preview document. KaTeX is
 * unconditional, the main bundle last.
 */
function buildScriptTags(
  nonce: string,
  uris: WebviewAssetUris,
  enableMermaid: boolean,
  enableExcalidraw: boolean
): string {
  const scriptUris = [uris.katexScript];
  if (enableMermaid) {
    scriptUris.push(uris.mermaidScript);
  }
  if (enableExcalidraw) {
    scriptUris.push(uris.excalidrawScript);
  }
  scriptUris.push(uris.mainScript);
  return scriptUris.map((src) => `  <script nonce="${nonce}" src="${src}"></script>`).join('\n');
}
