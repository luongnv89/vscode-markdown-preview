# Development Guide

## Setup

```bash
git clone https://github.com/luongnv89/vscode-markdown-preview.git
cd vscode-markdown-preview
npm install
```

## Development Workflow

### Watch Mode

```bash
npm run watch
```

This runs Webpack in watch mode, automatically rebuilding on file changes.

### Debug in VS Code

1. Open the project in VS Code
2. Press `F5` (or **Run > Start Debugging**)
3. This launches an **Extension Development Host** window
4. Open any `.md` file and press `Cmd+Shift+V` / `Ctrl+Shift+V`

The debug configuration is in `.vscode/launch.json`.

### Build for Production

```bash
npm run package
```

This creates an optimized build with hidden source maps in `dist/`.

## Key Scripts

| Script    | Command           | Description            |
| --------- | ----------------- | ---------------------- |
| `compile` | `npm run compile` | One-time Webpack build |
| `watch`   | `npm run watch`   | Webpack watch mode     |
| `package` | `npm run package` | Production build       |
| `lint`    | `npm run lint`    | ESLint check           |
| `test`    | `npm test`        | Run test suite         |

## Debugging Tips

### Extension Host Logs

Open **Output** panel in VS Code (`Cmd+Shift+U`) and select "Markdown Preview Pro" from the dropdown.

### Webview DevTools

In the Extension Development Host window:

1. Open Command Palette (`Cmd+Shift+P`)
2. Run **Developer: Open Webview Developer Tools**
3. Use the browser DevTools to inspect the preview panel

### Common Issues

- **Changes not appearing**: Make sure `npm run watch` is running
- **Webview blank**: Check the DevTools console for errors
- **Mermaid not rendering**: Mermaid renders client-side; check the webview console

## Adding a New Feature

1. Determine if the feature belongs in `src/` (extension host) or `webview/` (browser)
2. Add any new message types to `src/types/messages.ts` and `webview/types/`
3. Register message handlers in the appropriate process
4. Update configuration in `package.json` if adding a new setting
5. Test with the Extension Development Host
