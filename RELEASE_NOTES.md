## What's Changed in v0.8.0

### Features

- Add YAML frontmatter support — frontmatter between `---` delimiters is now parsed and displayed as a styled, collapsible metadata card at the top of the preview
- Frontmatter card renders key-value pairs in a clean table with clickable URLs, inline badge/image rendering, and array values as tags
- All frontmatter values are HTML-escaped for safety
- Scroll sync preserved with automatic line offset adjustment for stripped frontmatter
- New setting `markdownPreviewPro.showFrontmatter` (`"card"` | `"none"`) to control frontmatter display (default: `"card"`)

### Previous Changes (v0.7.0)

- Add Table of Contents (TOC) sidebar with active section highlighting
- Add Word Count & Reading Stats bar
- Add Presentation / Slide Mode with keyboard navigation
- Toolbar button grouping with visual separators

**Full Changelog**: https://github.com/luongnv89/vscode-markdown-preview/compare/v0.7.0...v0.8.0
