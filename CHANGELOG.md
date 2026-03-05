# Changelog

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
