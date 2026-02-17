# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-02-17

### Added

- Export to HTML with fully rendered Mermaid diagrams and KaTeX math
- Export to PDF using Chrome/Chromium (via puppeteer-core)
- Export commands available from editor title bar, right-click context menu, and Explorer context menu
- Standalone HTML builder with embedded styles, fonts, and scripts
- Auto-detection of Chrome/Chromium on macOS, Windows, and Linux

### Changed

- Markdown engine supports export context (rendering without webview)
- Image URI resolver supports file system paths for export mode
- Webpack configured with LimitChunkCountPlugin for single-file output

## [0.2.0] - 2026-02-17

### Added

- Right-click context menu to open preview from editor and Explorer sidebar
- Pre-commit hooks with Prettier, ESLint, and typecheck
- GitHub Actions CI pipeline
- API reference, user guide, and troubleshooting documentation
- Open-source community files (CONTRIBUTING, CODE_OF_CONDUCT, etc.)
- Screenshot in README

### Changed

- Updated publisher to luongnv89

## [0.1.0] - 2026-02-17

### Added

- Markdown rendering with markdown-it parser
- Syntax highlighting via highlight.js (GitHub Dark theme)
- Mermaid diagram rendering (flowcharts, sequence diagrams, etc.)
- KaTeX math rendering (inline and block)
- Interactive task list checkboxes with source sync
- Bidirectional scroll synchronization
- Copy-to-clipboard for code blocks
- Local image and Excalidraw diagram support
- Smart typography (quotes, replacements)
- Theme-aware rendering (adapts to VS Code light/dark theme)
- One-line installation script
- Configuration options for all features

[0.3.0]: https://github.com/luongnv89/vscode-markdown-preview/releases/tag/v0.3.0
[0.2.0]: https://github.com/luongnv89/vscode-markdown-preview/releases/tag/v0.2.0
[0.1.0]: https://github.com/luongnv89/vscode-markdown-preview/releases/tag/v0.1.0
