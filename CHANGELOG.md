# Changelog

## Unreleased

- Perf: HTML/PDF exports now embed only the vendor runtimes the document actually uses — a document with no math no longer carries the KaTeX script, stylesheet or ~1.4 MB of base64 fonts, and a document with no mermaid/excalidraw blocks no longer reads or embeds those vendor bundles (~26 MB). Needs are detected on the sanitized markup (the same `katex-*`/`mermaid-block`/`excalidraw-block` classes the render script queries), so a plain document's export drops to ~45 KB (~0.2% of the previous size) while documents using math or diagrams keep every asset they need; sanitization, per-export nonce CSP, and the `enable*` feature flags are unchanged (#74)
- Toolbar UX overhaul: the preview toolbar now rests at 0.95 opacity (was 0.4, ~1.8:1 contrast) so `--fg-muted` stays ≥4.5:1, brightens on `:focus-within`, and gives every button a `:focus-visible` outline, an `aria-label`, and 32×32 px targets with 6 px gap; the two export buttons carry persistent PDF/HTML text labels while icon-only buttons get immediate CSS hover labels, and a separator now leads the export group; export commands are contributed to the preview webview context menu; the manual theme toggle persists through `vscode.setState` (merged with the saved scroll position) and restores on reopen; and the TOC sidebar renders as an overlay drawer below 500 px instead of `display:none` while its button claimed active — toggle buttons also report state via `aria-pressed`/`aria-expanded` (#66, #67, #69)
- Fix `markdownPreviewPro.enableMermaid` and `markdownPreviewPro.enableExcalidraw` having no effect — the flags now gate diagram-block rendering in the engine (disabled fences render as plain code blocks), omit the mermaid/excalidraw vendor scripts (~4.86 MB) from the preview document and the standalone HTML/PDF export when disabled, and apply immediately via the `configChanged` message
- Security: stop the HTML/PDF export pipeline executing document JavaScript — rendered markdown is now sanitized with DOMPurify before it reaches the headless browser, the export document carries a per-export nonce Content-Security-Policy (no `unsafe-inline` in `script-src`), and Chromium's renderer sandbox is no longer disabled during export
- Security: harden the preview webview — Mermaid now runs at `securityLevel: 'strict'` (sanitized labels, no `click` JS directives) in both preview and export rendering, the preview CSP dropped `'unsafe-eval'` from `script-src` (verified unnecessary for Mermaid 11.x), `<body data-*>` extension metadata is attribute-escaped on write and the About popup renders it with `textContent`, and `img-src` is restricted to webview resources + `data:` unless the new `markdownPreviewPro.allowRemoteImages` opt-in (default `false`) is enabled

## 0.9.4

- Fix PDF export title and header visibility — change from light gray to bold black text
- Improve heading contrast in PDF exports with @media print styles
- Achieve WCAG AAA contrast compliance (21:1 ratio) for PDF export titles and headers

## 0.9.0

- Add Excalidraw diagram preview support — render `excalidraw` code blocks as interactive SVG diagrams in the preview panel
- New `@excalidraw/utils` vendor library for client-side Excalidraw-to-SVG conversion
- New `enableExcalidraw` configuration option (default: `true`) to toggle Excalidraw rendering
- Excalidraw diagrams automatically adapt to dark/light theme with re-rendering on theme change
- Full export support — Excalidraw diagrams render in HTML and PDF exports

## 0.8.2

- Add favicon, OpenGraph, Twitter Card, and JSON-LD structured data to landing page
- Add `robots.txt`, `sitemap.xml`, and `llms.txt` for SEO and AI crawler support
- Add canonical URL, theme-color meta tags, and meta description
- Add landing page link to README and `homepage` field to `package.json`
- Fix landing page generator whitespace normalization for CI compatibility

## 0.8.1

- Fix export timeout for documents with Mermaid diagrams — switch from `networkidle0` to `domcontentloaded` strategy for headless browser rendering
- Fix progress notification staying visible after export completes — move success message outside progress callback
- Increase page load timeout from 30s to 60s and render completion timeout from 15s to 30s for complex documents
- Add landing page with dark/light mode toggle and GitHub Pages deployment

## 0.8.0

- Add YAML frontmatter support — parse frontmatter between `---` delimiters and display as a styled, collapsible metadata card at the top of the preview
- Frontmatter card renders key-value pairs in a clean table with clickable URLs, inline badge/image rendering, and array values as tags
- All frontmatter values are HTML-escaped for safety
- Scroll sync preserved via automatic `data-line` offset adjustment for stripped frontmatter lines
- New `showFrontmatter` setting (`card` | `none`) to control frontmatter display (default: `card`)
- Add `yaml` package dependency for frontmatter parsing

## 0.7.0

- Add Table of Contents (TOC) sidebar — collapsible left panel listing all headings, click to scroll, highlights active section as you scroll
- Add Word Count & Reading Stats bar — fixed bottom bar showing word count, character count, and estimated reading time (200 wpm)
- Add Presentation / Slide Mode — splits content by `---` separators into slides with keyboard navigation (arrows, Space, Escape), slide counter, and smooth transitions
- Three new toolbar buttons: TOC toggle (list icon), Stats toggle (bar-chart icon), Presentation mode (play icon)
- Toolbar now groups buttons with a visual separator between feature toggles and export actions

## 0.6.1

- Default preview theme is now light, independent of VS Code theme
- Rewrite README for VS Code Marketplace — focus on installation and usage

## 0.6.0

- Add About button to preview toolbar with version, commit hash, maintainer, and repository link
- Clicking About toggles an info popup; clicking outside or clicking again dismisses it
- Repository link opens in external browser

## 0.5.0

- Add floating toolbar to preview with dark/light theme toggle, Export PDF, and Export HTML buttons
- Toolbar appears at top-right corner, semi-transparent until hover
- Theme toggle overrides preview colors independently from VS Code theme
- Mermaid diagrams respect toolbar theme override when re-rendering
- Toolbar is hidden in print preview

## 0.4.0

- Fix local image rendering (SVG, PNG, etc.) in webview preview
- Expand `localResourceRoots` to include filesystem root, matching VS Code built-in preview behavior
- Resolve images in raw HTML `<img>` tags that bypass the markdown-it image renderer
- Handle `file:` URIs and absolute file paths in image resolution
- Automatically recreate preview panel when switching to documents in uncovered directories

## 0.3.0

- Add export to HTML and PDF

## 0.2.0

- Add right-click context menu for markdown preview

## 0.1.0

- Initial release
