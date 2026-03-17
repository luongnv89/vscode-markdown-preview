## What's Changed in v0.9.0

### Features

- Add Excalidraw diagram preview support — render `excalidraw` fenced code blocks as interactive SVG diagrams in the preview panel
- New `@excalidraw/utils` vendor library (v0.1.2) for client-side Excalidraw JSON-to-SVG conversion
- New `enableExcalidraw` configuration option (default: `true`) to toggle Excalidraw rendering
- Excalidraw diagrams automatically adapt to dark/light theme with re-rendering on theme change
- Full export support — Excalidraw diagrams render correctly in HTML and PDF exports

### How It Works

Place Excalidraw JSON inside a fenced code block with the `excalidraw` language identifier:

````markdown
```excalidraw
{
  "type": "excalidraw",
  "version": 2,
  "elements": [...],
  "appState": { "viewBackgroundColor": "#ffffff" },
  "files": {}
}
```
````

The diagram renders as an SVG in the preview, just like Mermaid diagrams. This is fully compatible with `.excalidraw.md` files from Obsidian and other Excalidraw integrations.

**Full Changelog**: https://github.com/luongnv89/vscode-markdown-preview/compare/v0.8.2...v0.9.0
