## What's Changed in v0.8.2

### Features

- Add favicon to landing page (embedded as base64 from `media/icon.png`)
- Add OpenGraph and Twitter Card meta tags for social sharing
- Add JSON-LD `SoftwareApplication` structured data
- Add canonical URL, theme-color, and descriptive meta description
- Add landing page link to README and `homepage` field to `package.json`

### SEO & AI Crawlers

- Create `robots.txt` allowing all crawlers including AI bots (GPTBot, ClaudeBot, PerplexityBot, etc.)
- Create `sitemap.xml` with landing page URL
- Create `llms.txt` with AI-readable project summary

### Bug Fixes

- Fix landing page generator whitespace normalization so CI diff check passes

**Full Changelog**: https://github.com/luongnv89/vscode-markdown-preview/compare/v0.8.1...v0.8.2
