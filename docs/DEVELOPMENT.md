# Development Guide

## Environment

- **Node.js**: use **Node 20** (the version CI pins in `.github/workflows/ci.yml` and `.github/workflows/pages.yml`) or any newer LTS. The maintainer develops on Node v26.7.0, so newer majors work too.
- The runtime is declared as `engines.node` (`>=20.0.0`) in `package.json` and pinned by `.nvmrc` (`20`, the CI version) — `nvm use` picks it up automatically. There is still **no `.env.example`** — nothing to copy; clone and install.
- **npm** ships with Node; no global packages are required.

## Setup

```bash
git clone https://github.com/luongnv89/vscode-markdown-preview.git
cd vscode-markdown-preview
npm ci
```

`npm ci` performs a clean, reproducible install from `package-lock.json` — the same step CI runs. Use `npm install` only when you are intentionally changing dependencies.

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

| Script          | Command                 | Description                                                                                                            |
| --------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `compile`       | `npm run compile`       | One-time Webpack development build into `dist/`                                                                        |
| `watch`         | `npm run watch`         | Webpack watch mode — rebuilds `dist/` on file changes                                                                  |
| `package`       | `npm run package`       | Production build (`webpack --mode production --devtool hidden-source-map`) into `dist/`                                |
| `lint`          | `npm run lint`          | ESLint check over `src/` and `webview/`                                                                                |
| `format:check`  | `npm run format:check`  | Prettier check over the whole repo (same gate CI runs)                                                                 |
| `build:landing` | `npm run build:landing` | Regenerates the landing page at `docs/index.html` — a generated, gitignored file, so it never dirties the working tree |
| `test`          | `npm test`              | Builds the extension + `src/test/` into `out/`, then runs the Mocha suite inside an Extension Development Host         |

### Type checking

CI runs two TypeScript checks; run both before pushing:

```bash
npx tsc --noEmit -p tsconfig.json          # extension host (src/)
npx tsc --noEmit -p tsconfig.webview.json  # webview (webview/)
```

### `npm test`

`npm test` runs the `pretest` hook first (`npm run compile && npm run compile:test`), which builds the extension with Webpack and compiles `src/test/` with `tsconfig.test.json` into `out/test/` (source modules the tests import are loose-compiled alongside it under `out/`). `out/test/runTest.js` then uses `@vscode/test-electron` to download VS Code into `.vscode-test/` (gitignored), launches an Extension Development Host, and runs the Mocha suite in `src/test/suite/` (TDD `suite`/`test` style). The first run downloads VS Code (~300 MB); later runs reuse the cached copy. Recorded baseline: **35/35 passing**.

### `npm run build:landing` writes `docs/index.html`

`build:landing` runs `scripts/generate-landing.cjs`, which renders `docs/landing.md` into the generated file `docs/index.html`. The file is **gitignored** — a fresh checkout does not contain it, and CI never compares it against the commit. The Pages workflow regenerates it on every deploy, so running the command locally is always safe and its output is never committed.

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
