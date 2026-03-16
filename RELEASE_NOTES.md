## What's Changed in v0.8.1

### Bug Fixes

- Fix export timeout for documents with Mermaid diagrams — switch from `networkidle0` to `domcontentloaded` strategy for headless browser content loading
- Fix progress notification staying visible after export completes — move success message outside `withProgress` callback
- Increase page load timeout from 30s to 60s and render completion timeout from 15s to 30s to handle complex documents

### Features

- Add landing page with dark/light mode toggle and GitHub Pages deployment
- Landing page showcases code rendering, Mermaid diagrams, and KaTeX math

### Documentation

- Restructure landing page with developer-first layout
- Add deployment docs for GitHub Pages

**Full Changelog**: https://github.com/luongnv89/vscode-markdown-preview/compare/v0.8.0...v0.8.1
