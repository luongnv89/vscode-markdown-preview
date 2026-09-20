import * as vscode from 'vscode';
import { MarkdownEngine } from '../markdownEngine';
import { PreviewConfig } from '../types/messages';
import { buildWebviewHtml, PreviewAboutInfo } from './webviewHtml';
import { detectVendorNeeds, ALL_VENDOR_NEEDS, VendorNeeds } from './vendorNeeds';

/**
 * Build the preview's webview document with the vendor payload content-gated
 * on what the document actually renders to (issue #72): when a document is in
 * hand, run the render the first updateContent would run anyway and count the
 * feature markup it emits. With no document (e.g. a panel rebuilt around
 * nothing open) every vendor tag ships — the old unconditional behavior,
 * which the lazy loader would simply never exercise. A document that gains a
 * feature later is covered by webview/vendorLoader.ts injecting the missing
 * runtime on first use, so this gate never needs a webview reload.
 *
 * CSP and <body data-*> metadata live in buildWebviewHtml: nonce-only
 * script-src (Mermaid renders without eval — verified in headless Chromium),
 * img-src restricted to webview resources + data: unless the documented
 * markdownPreviewPro.allowRemoteImages opt-in is enabled, and all data-*
 * values attribute-escaped on write.
 */
export function buildPreviewWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  aboutInfo: PreviewAboutInfo,
  config: PreviewConfig,
  engine: MarkdownEngine,
  document?: vscode.TextDocument
): string {
  return buildWebviewHtml(
    webview,
    extensionUri,
    aboutInfo,
    config.allowRemoteImages,
    {
      enableKatex: config.enableKatex,
      enableMermaid: config.enableMermaid,
      enableExcalidraw: config.enableExcalidraw,
    },
    computeVendorNeeds(webview, engine, config, document)
  );
}

function computeVendorNeeds(
  webview: vscode.Webview,
  engine: MarkdownEngine,
  config: PreviewConfig,
  document: vscode.TextDocument | undefined
): VendorNeeds {
  if (!document) {
    return ALL_VENDOR_NEEDS;
  }
  engine.setContext(document.uri, webview);
  const { html } = engine.render(document.getText());
  return detectVendorNeeds(html, {
    enableKatex: config.enableKatex,
    enableMermaid: config.enableMermaid,
    enableExcalidraw: config.enableExcalidraw,
  });
}
