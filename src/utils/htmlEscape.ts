// The single escapeHtml implementation for the whole repo (issue #55). It
// used to exist in four places — here (as a private helper inside
// frontmatter.ts), standaloneHtmlBuilder, webview/renderer.ts and
// scripts/generate-landing.cjs. The webview copy was DOM-based and escaped a
// different character set (no `"`), a latent bug rather than just
// duplication; the webview now inserts error text via textContent instead of
// escaping for innerHTML, so no second implementation is needed across the
// extension-host/webview boundary (the webview tsconfig cannot import src/).
//
// Kept vscode-free on purpose: markdownCore.ts re-exports it so the compiled
// dist/markdownCore.js hands the same function to scripts/generate-landing.cjs.
//
// Character set: `&`, `<`, `>` and `"` — the same four markdown-it's own
// escapeHtml covers. `"` matters because callers interpolate into
// double-quoted attributes (`<img src="...">`). Single-quoted attribute
// contexts need `'` too — that is escapeHtmlAttr's job (src/utils/webviewHtml.ts),
// which delegates here rather than maintaining a second chain.
//
// String() coercion keeps the scripts/generate-landing.cjs call sites safe:
// they interpolate YAML frontmatter values, where `version: 1.0` arrives as a
// number — the generator's old local copy coerced the same way.
export function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
