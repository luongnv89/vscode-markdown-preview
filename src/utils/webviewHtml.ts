import * as vscode from 'vscode';
import { escapeHtml } from './htmlEscape';
import { getNonce } from './uri';
import { ALL_VENDOR_NEEDS, VendorNeeds } from './vendorNeeds';

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
 * The `markdownPreviewPro.enable*` flags the vendor gate consults. All three
 * default to on; a flag set false keeps that vendor tag out of the document
 * even when `needs` says the markup uses it (defense in depth — the engine
 * emits no such markup when the flag is off).
 */
export interface PreviewFeatureFlags {
  enableKatex?: boolean;
  enableMermaid?: boolean;
  enableExcalidraw?: boolean;
}

/**
 * Escape a value for interpolation into a double-quoted HTML attribute
 * (`<body data-*="...">`). Escaping `&`, `<`, `>`, `"` and `'` keeps a
 * hostile value from terminating the attribute or opening a new element —
 * the `<body data-*>` values are read back by the webview via `dataset`.
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
 *
 * Vendor gating (issue #72): a vendor `<script>` tag is emitted only when the
 * feature flag is on AND `needs` says the rendered markup actually uses the
 * runtime — a document with no math and no diagrams ships zero vendor
 * bundles, so its parsed payload is just main.js + main.css (~102 KB)
 * instead of ~4.9 MB. The same gate drops the KaTeX stylesheet for
 * math-free documents.
 *
 * A live document can grow a feature after this HTML shipped (the user types
 * their first ```mermaid fence). The webview never reloads for that — the
 * resolved vendor URLs ship unconditionally as `data-vendor-*` attributes
 * (a data attribute never fetches), and webview/vendorLoader.ts injects the
 * missing nonce'd <script>/<link> tags on first use. Every shipped tag is
 * marked `data-vendor="<key>"` so the loader can recognize a tag it already
 * manages — a settled tag whose global never appeared is dropped and a
 * fresh one injected, keeping retry dedupe to a single element.
 * `script-src` stays nonce-only either way — no CSP change is needed for a
 * shorter tag list.
 */
export function buildWebviewHtml(
  webview: WebviewResourceSource,
  extensionUri: vscode.Uri,
  aboutInfo: PreviewAboutInfo,
  allowRemoteImages: boolean,
  features: PreviewFeatureFlags = {},
  needs: VendorNeeds = ALL_VENDOR_NEEDS
): string {
  const nonce = getNonce();
  const assetUris = resolveWebviewAssetUris(webview, extensionUri);
  const flags = {
    enableKatex: features.enableKatex ?? true,
    enableMermaid: features.enableMermaid ?? true,
    enableExcalidraw: features.enableExcalidraw ?? true,
  };
  const katexStyleTag =
    flags.enableKatex && needs.math
      ? `  <link rel="stylesheet" href="${assetUris.katexStyle}" data-vendor-css="katex">\n`
      : '';
  const scriptTags = buildScriptTags(nonce, assetUris, flags, needs);
  const cspMeta = buildCspMeta(nonce, webview.cspSource, allowRemoteImages);
  const bodyAttrs = buildBodyAttrs(aboutInfo, assetUris);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
${cspMeta}
${katexStyleTag}  <link rel="stylesheet" href="${assetUris.mainStyle}">
  <title>Markdown Preview Pro</title>
</head>
<body${bodyAttrs}>
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
 * The CSP meta element. `script-src` is nonce-only — the gated vendor list
 * changes nothing here, and the lazy loader's injected tags carry the same
 * nonce. `img-src` restricts remote images unless the documented
 * markdownPreviewPro.allowRemoteImages opt-in is set.
 */
function buildCspMeta(nonce: string, cspSource: string, allowRemoteImages: boolean): string {
  const imgSrc = allowRemoteImages
    ? `img-src ${cspSource} https: data:`
    : `img-src ${cspSource} data:`;
  return `  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
      script-src 'nonce-${nonce}';
      style-src ${cspSource} 'unsafe-inline';
      ${imgSrc};
      font-src ${cspSource};
      connect-src ${cspSource};
      worker-src 'none';
      frame-src 'none';">`;
}

/**
 * The <body> data-* attributes: About metadata plus the resolved vendor URIs
 * the lazy loader reads on first feature use (issue #72). The vendor URIs
 * ship unconditionally — a data attribute never fetches — so a document that
 * gains a feature on update needs no reload to find its runtime URL.
 */
function buildBodyAttrs(aboutInfo: PreviewAboutInfo, assetUris: WebviewAssetUris): string {
  const attrs: Array<[string, string]> = [
    ['data-version', aboutInfo.version],
    ['data-commit', aboutInfo.commit],
    ['data-publisher', aboutInfo.publisher],
    ['data-repo', aboutInfo.repo],
    ['data-vendor-katex', assetUris.katexScript.toString()],
    ['data-vendor-katex-css', assetUris.katexStyle.toString()],
    ['data-vendor-mermaid', assetUris.mermaidScript.toString()],
    ['data-vendor-excalidraw', assetUris.excalidrawScript.toString()],
  ];
  return attrs.map(([name, value]) => ` ${name}="${escapeHtmlAttr(value)}"`).join('');
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
 * Emit a vendor <script> only for enabled features the document's markup
 * actually uses — a runtime the render did not reference never reaches the
 * preview document (#72). Each emitted tag carries `data-vendor` so the
 * lazy loader can recognize a tag it already manages — a settled tag with
 * no global is dropped and replaced by an injected retry; the main bundle
 * loads last.
 */
function buildScriptTags(
  nonce: string,
  uris: WebviewAssetUris,
  flags: Required<PreviewFeatureFlags>,
  needs: VendorNeeds
): string {
  const scriptUris: Array<{ src: vscode.Uri; vendor?: string }> = [];
  if (flags.enableKatex && needs.math) {
    scriptUris.push({ src: uris.katexScript, vendor: 'katex' });
  }
  if (flags.enableMermaid && needs.mermaid) {
    scriptUris.push({ src: uris.mermaidScript, vendor: 'mermaid' });
  }
  if (flags.enableExcalidraw && needs.excalidraw) {
    scriptUris.push({ src: uris.excalidrawScript, vendor: 'excalidraw' });
  }
  scriptUris.push({ src: uris.mainScript });
  return scriptUris
    .map(({ src, vendor }) => {
      const vendorAttr = vendor ? ` data-vendor="${vendor}"` : '';
      return `  <script nonce="${nonce}" src="${src}"${vendorAttr}></script>`;
    })
    .join('\n');
}
