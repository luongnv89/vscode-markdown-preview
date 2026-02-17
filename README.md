# Markdown Preview Pro

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%3E%3D1.85.0-blue.svg)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/badge/version-0.1.0-green.svg)](https://github.com/luongnv89/vscode-markdown-preview/releases)

A clean, minimal markdown preview for Visual Studio Code inspired by the [Zed editor](https://zed.dev/). Provides an enhanced markdown viewing experience with syntax highlighting, interactive diagrams, math rendering, and real-time synchronization.

![Markdown Preview Pro](media/icon.png)

## Features

- **Syntax Highlighting** - Powered by highlight.js with GitHub Dark theme and auto-language detection
- **Mermaid Diagrams** - Render flowcharts, sequence diagrams, and more directly in preview
- **KaTeX Math** - Inline (`$...$`) and block (`$$...$$`) math rendering
- **Interactive Task Lists** - Toggle checkboxes in preview and sync changes back to source
- **Bidirectional Scroll Sync** - Editor and preview scroll positions stay in sync
- **Copy Code Blocks** - One-click copy button on all code blocks
- **Image Support** - Local images, workspace-relative paths, and Excalidraw diagrams
- **Smart Typography** - Optional smart quotes and typographic replacements
- **Theme-Aware** - Adapts to your VS Code light/dark theme

## Quick Start

### One-Line Install

```bash
curl -sSL https://raw.githubusercontent.com/luongnv89/vscode-markdown-preview/main/install.sh | bash
```

### Manual Install

1. Clone the repository:
   ```bash
   git clone https://github.com/luongnv89/vscode-markdown-preview.git
   cd vscode-markdown-preview
   ```

2. Install dependencies and build:
   ```bash
   npm install
   npm run package
   ```

3. Package and install the extension:
   ```bash
   npx @vscode/vsce package --no-dependencies
   code --install-extension markdown-preview-pro-*.vsix
   ```

### Prerequisites

- [VS Code](https://code.visualstudio.com/) >= 1.85.0
- [Node.js](https://nodejs.org/) >= 18

## Usage

1. Open any `.md` file in VS Code
2. Use one of these methods to open the preview:
   - Press `Cmd+Shift+V` (macOS) or `Ctrl+Shift+V` (Windows/Linux)
   - Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and search for **Markdown Preview Pro: Open Preview to Side**
   - Click the preview icon in the editor title bar

## Configuration

Configure via VS Code Settings (`markdownPreviewPro.*`):

| Setting | Default | Description |
|---------|---------|-------------|
| `scrollSync` | `true` | Bidirectional scroll synchronization |
| `enableMermaid` | `true` | Mermaid diagram rendering |
| `enableKatex` | `true` | KaTeX math rendering |
| `enableCheckboxes` | `true` | Interactive task list checkboxes |
| `typographer` | `true` | Smart quotes and typography |
| `lineBreaks` | `false` | Convert newlines to `<br>` tags |

## Project Structure

```
vscode-markdown-preview/
├── src/                    # Extension source (Node.js)
│   ├── extension.ts        # Entry point
│   ├── previewManager.ts   # Preview panel management
│   ├── markdownEngine.ts   # Markdown rendering engine
│   ├── checkboxHandler.ts  # Interactive checkbox logic
│   ├── scrollSync.ts       # Scroll synchronization
│   ├── types/              # TypeScript type definitions
│   └── utils/              # Configuration & URI utilities
├── webview/                # Webview client (Browser)
│   ├── main.ts             # Webview entry point
│   ├── renderer.ts         # Content rendering
│   ├── scrollSync.ts       # Client-side scroll sync
│   ├── blockHighlighter.ts # Code block highlighting
│   ├── copyButton.ts       # Copy-to-clipboard
│   ├── checkboxHandler.ts  # Checkbox interaction
│   ├── navigationHandler.ts# Link navigation
│   └── styles/             # CSS stylesheets
├── dist/                   # Compiled output
├── test/                   # Test suite
├── docs/                   # Documentation
├── package.json            # Extension manifest
├── webpack.config.js       # Build configuration
└── tsconfig.json           # TypeScript configuration
```

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript |
| Markdown Parser | [markdown-it](https://github.com/markdown-it/markdown-it) v14 |
| Syntax Highlighting | [highlight.js](https://highlightjs.org/) v11 |
| Math Rendering | [KaTeX](https://katex.org/) v0.16 |
| Diagrams | [Mermaid](https://mermaid.js.org/) v10 |
| Task Lists | [markdown-it-task-lists](https://github.com/revin/markdown-it-task-lists) |
| Build Tool | [Webpack](https://webpack.js.org/) v5 |

## Documentation

| Document | Description |
|----------|-------------|
| [User Guide](docs/USER_GUIDE.md) | Comprehensive feature guide with examples |
| [Architecture](docs/ARCHITECTURE.md) | System design and component overview |
| [API Reference](docs/API.md) | Internal APIs and message protocol |
| [Development](docs/DEVELOPMENT.md) | Local setup and debugging |
| [Deployment](docs/DEPLOYMENT.md) | Building and publishing |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Common issues and solutions |
| [Changelog](docs/CHANGELOG.md) | Version history |

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
