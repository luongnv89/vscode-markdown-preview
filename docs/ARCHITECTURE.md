# Architecture

## Overview

Markdown Preview Pro is a VS Code extension that uses a **two-process architecture** to provide rich markdown preview capabilities.

```mermaid
graph LR
    subgraph VS Code
        subgraph Extension Host - Node.js
            EXT[extension.ts]
            PM[PreviewManager]
            ME[MarkdownEngine]
            SS1[ScrollSync]
            CH1[checkboxHandler]
        end
        subgraph Webview - Browser Sandbox
            MAIN[main.ts]
            REN[renderer.ts]
            SS2[scrollSync.ts]
            COPY[copyButton.ts]
            BH[blockHighlighter.ts]
            CH2[checkboxHandler.ts]
            NAV[navigationHandler.ts]
        end
    end

    EXT --> PM
    PM --> ME
    PM --> SS1
    PM <-->|postMessage| MAIN
    MAIN --> REN
    MAIN --> SS2
    MAIN --> COPY
    MAIN --> BH
    MAIN --> CH2
    MAIN --> NAV
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

Communication between extension host and webview uses VS Code's `postMessage` API. See [API Reference](API.md) for the full message protocol.

```mermaid
sequenceDiagram
    participant Editor
    participant PreviewManager
    participant MarkdownEngine
    participant Webview

    Note over Webview: Panel loads
    Webview->>PreviewManager: ready

    Note over Editor: User edits document
    Editor->>PreviewManager: onDidChangeTextDocument
    PreviewManager->>PreviewManager: debounce (300ms)
    PreviewManager->>MarkdownEngine: render(text)
    MarkdownEngine-->>PreviewManager: { html }
    PreviewManager->>Webview: updateContent

    Note over Webview: User clicks checkbox
    Webview->>PreviewManager: toggleCheckbox(line, checked)
    PreviewManager->>Editor: WorkspaceEdit (toggle [ ]/[x])

    Note over Editor: User scrolls
    Editor->>PreviewManager: onDidChangeVisibleRanges
    PreviewManager->>Webview: scrollToLine(line)

    Note over Webview: User scrolls preview
    Webview->>PreviewManager: revealLine(line)
    PreviewManager->>Editor: revealRange(line)
```

### Content Update

```
Editor Change → Debounce (300ms) → markdownEngine.render()
    → previewManager sends "updateContent" message
    → webview renderer updates DOM
    → Mermaid/KaTeX render client-side
```

### Scroll Sync

Bidirectional scroll sync with a 300ms lock to prevent feedback loops:

```mermaid
graph LR
    A[Editor Scroll] -->|getVisibleLine| B[ScrollSync]
    B -->|scrollToLine| C[Webview]
    C -->|revealLine| D[ScrollSync]
    D -->|revealEditorLine| A

    B -->|lock 300ms| B
    D -->|lock 300ms| D
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

```mermaid
graph TD
    SRC[src/extension.ts] -->|Webpack| DIST1[dist/extension.js<br/>CommonJS / Node.js]
    WEB[webview/main.ts] -->|Webpack| DIST2[dist/webview/main.js<br/>Browser bundle]
    CSS[webview/styles/*.css] -->|MiniCssExtract| DIST3[dist/webview/main.css]
    VENDOR[node_modules] -->|CopyWebpackPlugin| DIST4[dist/webview/vendor/<br/>katex, mermaid, hljs]
```

1. **Extension** (`src/extension.ts` → `dist/extension.js`) - CommonJS for Node.js
2. **Webview** (`webview/main.ts` → `dist/webview/main.js`) - Browser bundle with CSS
3. **Vendor files** - KaTeX, Mermaid, and highlight.js are copied to `dist/webview/vendor/`

CSS files are extracted via `mini-css-extract-plugin` into `dist/webview/main.css`.

## Security

The webview uses a strict Content Security Policy:

- `default-src 'none'` - Block everything by default
- `script-src 'nonce-...' 'unsafe-eval'` - Only nonced scripts (Mermaid needs `unsafe-eval`)
- `style-src ... 'unsafe-inline'` - Extension styles and inline styles
- `img-src ... https: data:` - Local images, HTTPS images, and data URIs
- `frame-src 'none'` - No iframes within the webview
- `worker-src 'none'` - No web workers

## Related Docs

- [API Reference](API.md) - Message protocol and class documentation
- [Development](DEVELOPMENT.md) - How to set up and debug
- [Deployment](DEPLOYMENT.md) - Building and publishing
