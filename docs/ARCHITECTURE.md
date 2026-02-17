# Architecture

## Overview

Markdown Preview Pro is a VS Code extension that uses a **two-process architecture** to provide rich markdown preview capabilities.

```
┌──────────────────────────────────────────────────────┐
│                    VS Code                           │
│                                                      │
│  ┌──────────────────┐     ┌───────────────────────┐  │
│  │  Extension Host  │     │   Webview Panel        │  │
│  │  (Node.js)       │────>│   (Browser Sandbox)    │  │
│  │                  │<────│                         │  │
│  │  - Markdown      │ msg │  - HTML Rendering      │  │
│  │    parsing       │     │  - Mermaid diagrams    │  │
│  │  - File I/O      │     │  - KaTeX math          │  │
│  │  - Config        │     │  - Scroll sync         │  │
│  │  - Scroll sync   │     │  - User interactions   │  │
│  └──────────────────┘     └───────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

## Extension Host (`src/`)

Runs in Node.js within VS Code's extension host process.

| File | Responsibility |
|------|---------------|
| `extension.ts` | Entry point, registers commands |
| `previewManager.ts` | Creates/manages webview panels, handles lifecycle |
| `markdownEngine.ts` | Configures markdown-it with plugins, renders markdown to HTML |
| `checkboxHandler.ts` | Syncs checkbox state changes back to the source document |
| `scrollSync.ts` | Calculates scroll positions from editor cursor |
| `utils/config.ts` | Reads VS Code configuration settings |
| `utils/uri.ts` | Resolves local image and resource URIs |

## Webview (`webview/`)

Runs in an isolated browser context (iframe) managed by VS Code.

| File | Responsibility |
|------|---------------|
| `main.ts` | Webview entry point, initializes all handlers |
| `renderer.ts` | Updates DOM, triggers Mermaid/KaTeX rendering |
| `scrollSync.ts` | Client-side scroll position tracking |
| `blockHighlighter.ts` | Highlights code blocks on hover |
| `copyButton.ts` | Adds copy-to-clipboard buttons to code blocks |
| `checkboxHandler.ts` | Captures checkbox clicks, sends messages to extension |
| `navigationHandler.ts` | Handles link clicks (internal navigation, external URLs) |

## Message Flow

### Content Update

```
Editor Change → Debounce (300ms) → markdownEngine.render()
    → previewManager sends "updateContent" message
    → webview renderer updates DOM
    → Mermaid/KaTeX render client-side
```

### Scroll Sync (Editor → Preview)

```
Editor scroll/cursor → scrollSync calculates target line
    → sends "scrollToLine" message
    → webview finds element with matching data-line attribute
    → scrolls to position
```

### Checkbox Toggle

```
User clicks checkbox in webview
    → checkboxHandler sends "toggleCheckbox" message with line number
    → extension finds the line in source document
    → toggles `[ ]` / `[x]` in the actual file
    → triggers content re-render
```

## Build System

Webpack bundles two separate entry points:

1. **Extension** (`src/extension.ts` → `dist/extension.js`) - CommonJS for Node.js
2. **Webview** (`webview/main.ts` → `dist/webview.js`) - Browser bundle with CSS

CSS files are extracted via `mini-css-extract-plugin` into `dist/webview.css`.
