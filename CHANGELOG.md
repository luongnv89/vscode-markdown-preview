# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.6] - 2026-09-21

- Fix: the preview follows the VS Code color theme (including GitHub Dark) until the toolbar toggle pins an explicit overlay — chrome and highlight.js no longer freeze a Primer/light palette over live editor tokens, and switching the host theme drops a stale overlay (#4)
- Fix: clicking a Table of Contents entry now scrolls to that heading instead of jumping to the document header — TOC navigation uses the same programmatic `scrollToLine` path as editor↔preview sync, so scroll-sync cannot override an in-flight jump (#6)

## [0.9.5] - 2026-09-20

- Perf: the generated landing page (`docs/index.html`) drops from ~7.8 MB to ~515 KB — vendor runtimes (KaTeX, Mermaid) and the KaTeX stylesheet/fonts are emitted as separate cacheable files under `docs/assets/` instead of being inlined, gated on the shared `detectVendorNeeds` content probe so a page with no math or diagrams ships neither runtime; the client-side render script and JSON-LD are external too, leaving every `<script>` element `src`-backed with under 1 KB of inline script text (#78)
- Fix the landing page publishing a stale version — its JSON-LD `softwareVersion` now reads `package.json` at build time instead of a hardcoded frontmatter key (dropped from `docs/landing.md`), and the self-generation note moved from ahead of the screenshot to beside the rendering showcase where it reads as evidence (#71)
- Perf: HTML/PDF exports now embed only the vendor runtimes the document actually uses — a document with no math no longer carries the KaTeX script, stylesheet or ~1.4 MB of base64 fonts, and a document with no mermaid/excalidraw blocks no longer reads or embeds those vendor bundles (~26 MB). Needs are detected on the sanitized markup (the same `katex-*`/`mermaid-block`/`excalidraw-block` classes the render script queries), so a plain document's export drops to ~45 KB (~0.2% of the previous size) while documents using math or diagrams keep every asset they need; sanitization, per-export nonce CSP, and the `enable*` feature flags are unchanged (#74)
- Toolbar UX overhaul: the preview toolbar now rests at 0.95 opacity (was 0.4, ~1.8:1 contrast) so `--fg-muted` stays ≥4.5:1, brightens on `:focus-within`, and gives every button a `:focus-visible` outline, an `aria-label`, and 32×32 px targets with 6 px gap; the two export buttons carry persistent PDF/HTML text labels while icon-only buttons get immediate CSS hover labels, and a separator now leads the export group; export commands are contributed to the preview webview context menu; the manual theme toggle persists through `vscode.setState` (merged with the saved scroll position) and restores on reopen; and the TOC sidebar renders as an overlay drawer below 500 px instead of `display:none` while its button claimed active — toggle buttons also report state via `aria-pressed`/`aria-expanded` (#66, #67, #69)
- Fix `markdownPreviewPro.enableMermaid` and `markdownPreviewPro.enableExcalidraw` having no effect — the flags now gate diagram-block rendering in the engine (disabled fences render as plain code blocks), omit the mermaid/excalidraw vendor scripts (~4.86 MB) from the preview document and the standalone HTML/PDF export when disabled, and apply immediately via the `configChanged` message
- Security: stop the HTML/PDF export pipeline executing document JavaScript — rendered markdown is now sanitized with DOMPurify before it reaches the headless browser, the export document carries a per-export nonce Content-Security-Policy (no `unsafe-inline` in `script-src`), and Chromium's renderer sandbox is no longer disabled during export
- Security: harden the preview webview — Mermaid now runs at `securityLevel: 'strict'` (sanitized labels, no `click` JS directives) in both preview and export rendering, the preview CSP dropped `'unsafe-eval'` from `script-src` (verified unnecessary for Mermaid 11.x), `<body data-*>` extension metadata is attribute-escaped on write and the About popup renders it with `textContent`, and `img-src` is restricted to webview resources + `data:` unless the new `markdownPreviewPro.allowRemoteImages` opt-in (default `false`) is enabled
- Perf: the preview emits vendor bundles only for runtimes the document actually uses — `detectVendorNeeds` gates the mermaid/excalidraw/katex `<script>`/`<link>` tags in the initial webview HTML, so a plain document ships zero vendor bytes instead of ~4.9 MB parsed on every open (#72)
- Perf: the extension bundle drops from ~7.8 MB to ~416 KB — highlight.js registers a 28-language subset instead of the ~190-grammar umbrella entry, and export-only heavyweights (jsdom, puppeteer-core) emit as lazy chunks loaded on first export use (#73)
- Perf: diagram renders are cached by source hash — mermaid/excalidraw blocks no longer re-render on every keystroke, render ids derive from the hash, and the cache clears on theme change (#75)
- Perf: activation no longer spawns git — the commit SHA is baked at build time and About info is collected lazily — and the markdown engine rebuilds only on real configuration change rather than every update (#76)
- Perf: preview updates patch the DOM incrementally instead of replacing the rendered document, preserving scroll position and previously rendered diagrams across edits (#77)
- Preview polish: a skeleton placeholder distinguishes a loading preview from a failed one, diagram errors name the document line and block type with raw parser output collapsed in a `<details>`, presentation mode explains the `---` slide convention and shows a readable nav hint, and overlay/slide/TOC animations honour `prefers-reduced-motion` (#68, #70)
- Fix: HTML/PDF export confirms the output path via the OS save dialog (pre-filled `<basename>.<ext>`) and the progress notification is cancellable, so a long export aborts promptly (#31)
- Fix: image embedding in standalone exports and the landing generator rewrites the matched `<img>` tag instead of the first textual occurrence of its src — a repeated image or a path quoted in prose no longer corrupts the document (#30)
- Fix: raw-HTML `<img>` rewriting moved into the html_block/html_inline renderer rules with a quote-aware tag pattern — fenced and inline code can never match, and `>` inside quoted attribute values no longer defeats the match (#35)
- Fix: the frontmatter line offset now applies in the token pass, so scroll sync and interactive checkboxes map to the correct source lines in documents with frontmatter (#34)
- Fix: activation failures surface via an error notification and re-throw instead of being swallowed and leaving the extension half-registered (#33)
- Security: path-containment guards now use `path.relative` checks instead of `startsWith` prefix matching (a sibling directory like `notes-private/` can no longer pass), the preview `localResourceRoots` is narrowed to the webview bundle plus workspace folders and the document directory rather than the filesystem root, and export assets refused by containment surface a warning instead of being silently dropped (#27, #28)
- Fix: the frontmatter card title and key labels print black in PDF exports via a `@media print` rule, matching the existing print-contrast rules (#139)
- Deps: resolved 9 high-severity npm audit advisories and dropped the `yauzl` override (#22); the toolchain moved to Node 24 LTS, TypeScript 7 and puppeteer-core 25 (#36, #44, #49)

## [0.9.4] - 2026-05-19

- Fix PDF export title and header visibility — change from light gray to bold black text
- Improve heading contrast in PDF exports with @media print styles
- Achieve WCAG AAA contrast compliance (21:1 ratio) for PDF export titles and headers

## [0.9.3] - 2026-04-09

- Fix syntax highlighting and diagrams (Mermaid, Excalidraw) drifting out of sync with the preview theme toggle — light/dark highlight.js color rules now follow the `preview-theme-*` body class, the initial theme is detected from the VS Code body class instead of always defaulting to light, and diagram re-renders survive the DOM replacement via a `data-source` attribute on wrapper divs
- Fix inline-code background leaking into fenced code blocks
- Drop `github-dark.min.css` from the standalone export stylesheet — syntax highlighting now comes from the shared `code.css` token rules

## [0.9.2] - 2026-04-08

- Resolve all npm audit vulnerabilities — mermaid 10.6.1 → 11.14.0 (lodash-es High, dompurify Medium), puppeteer-core 24.37.3 → 24.40.0 (basic-ftp Critical), yaml 2.8.2 → 2.8.3 (stack overflow Medium), copy-webpack-plugin 13 → 14 (serialize-javascript High), and a `yauzl` override for CVE-2026-31988 transitive via puppeteer-core

## [0.9.1] - 2026-03-17

- Fix exporting from the preview toolbar — the Export PDF/HTML buttons reached no document because `activeTextEditor` is undefined while the webview holds focus; the tracked `activeDocument` URI is now passed to the export command

## [0.9.0] - 2026-03-17

- Add Excalidraw diagram preview support — render `excalidraw` code blocks as interactive SVG diagrams in the preview panel
- New `@excalidraw/utils` vendor library for client-side Excalidraw-to-SVG conversion
- New `enableExcalidraw` configuration option (default: `true`) to toggle Excalidraw rendering
- Excalidraw diagrams automatically adapt to dark/light theme with re-rendering on theme change
- Full export support — Excalidraw diagrams render in HTML and PDF exports

## [0.8.2] - 2026-03-16

- Add favicon, OpenGraph, Twitter Card, and JSON-LD structured data to landing page
- Add `robots.txt`, `sitemap.xml`, and `llms.txt` for SEO and AI crawler support
- Add canonical URL, theme-color meta tags, and meta description
- Add landing page link to README and `homepage` field to `package.json`
- Fix landing page generator whitespace normalization for CI compatibility

## [0.8.1] - 2026-03-16

- Fix export timeout for documents with Mermaid diagrams — switch from `networkidle0` to `domcontentloaded` strategy for headless browser rendering
- Fix progress notification staying visible after export completes — move success message outside progress callback
- Increase page load timeout from 30s to 60s and render completion timeout from 15s to 30s for complex documents
- Add landing page with dark/light mode toggle and GitHub Pages deployment

## [0.8.0] - 2026-03-09

- Add YAML frontmatter support — parse frontmatter between `---` delimiters and display as a styled, collapsible metadata card at the top of the preview
- Frontmatter card renders key-value pairs in a clean table with clickable URLs, inline badge/image rendering, and array values as tags
- All frontmatter values are HTML-escaped for safety
- Scroll sync preserved via automatic `data-line` offset adjustment for stripped frontmatter lines
- New `showFrontmatter` setting (`card` | `none`) to control frontmatter display (default: `card`)
- Add `yaml` package dependency for frontmatter parsing

## [0.7.0] - 2026-03-05

- Add Table of Contents (TOC) sidebar — collapsible left panel listing all headings, click to scroll, highlights active section as you scroll
- Add Word Count & Reading Stats bar — fixed bottom bar showing word count, character count, and estimated reading time (200 wpm)
- Add Presentation / Slide Mode — splits content by `---` separators into slides with keyboard navigation (arrows, Space, Escape), slide counter, and smooth transitions
- Three new toolbar buttons: TOC toggle (list icon), Stats toggle (bar-chart icon), Presentation mode (play icon)
- Toolbar now groups buttons with a visual separator between feature toggles and export actions

## [0.6.1] - 2026-03-05

- Default preview theme is now light, independent of VS Code theme
- Rewrite README for VS Code Marketplace — focus on installation and usage

## [0.6.0] - 2026-02-20

- Add About button to preview toolbar with version, commit hash, maintainer, and repository link
- Clicking About toggles an info popup; clicking outside or clicking again dismisses it
- Repository link opens in external browser

## [0.5.0] - 2026-02-20

- Add floating toolbar to preview with dark/light theme toggle, Export PDF, and Export HTML buttons
- Toolbar appears at top-right corner, semi-transparent until hover
- Theme toggle overrides preview colors independently from VS Code theme
- Mermaid diagrams respect toolbar theme override when re-rendering
- Toolbar is hidden in print preview

## [0.4.0] - 2026-02-18

- Fix local image rendering (SVG, PNG, etc.) in webview preview
- Expand `localResourceRoots` to include filesystem root, matching VS Code built-in preview behavior
- Resolve images in raw HTML `<img>` tags that bypass the markdown-it image renderer
- Handle `file:` URIs and absolute file paths in image resolution
- Automatically recreate preview panel when switching to documents in uncovered directories

## [0.3.0] - 2026-02-17

- Add export to HTML and PDF

## [0.2.0] - 2026-02-17

- Add right-click context menu for markdown preview

## [0.1.0] - 2026-02-17

- Initial release
