@AGENTS.md

# CLAUDE.md — Markdown Preview Pro

## Project

- VS Code extension (`markdown-preview-pro`): markdown preview with syntax highlighting, Mermaid, KaTeX, Excalidraw, interactive checkboxes, scroll sync, HTML/PDF export.
- Two-process architecture: extension host (`src/`, Node.js) ↔ webview (`webview/`, browser sandbox) over `postMessage`. Invariant: all host↔webview traffic goes through the typed message protocol — never bypass it.

## Commands

- Install: `npm ci` — Node 20 (the CI pin, also in `.nvmrc`; `engines.node` declares `>=20.0.0`) or newer LTS; no `.env.example` exists.
- Dev build: `npm run compile` — one-time Webpack build into `dist/` (`npm run watch` for rebuild-on-change).
- Production build: `npm run package` — optimized bundle with hidden source maps.
- Lint: `npm run lint` — ESLint over `src/` and `webview/`.
- Format gate: `npm run format:check` — Prettier check, same as CI.
- Typecheck — run **both**, CI does:
  - `npx tsc --noEmit -p tsconfig.json` (extension host, `src/`)
  - `npx tsc --noEmit -p tsconfig.webview.json` (webview, `webview/`)
- `npm test` is **non-functional** until Task 0.3 lands: it resolves to `dist/test/runTest.js`, which has never been built, and fails with `MODULE_NOT_FOUND`. Validate with lint + format:check + both typechecks instead.
- Debug: `F5` in VS Code launches the Extension Development Host (`.vscode/launch.json`).

## Layout

- `src/` — extension host: `extension.ts` (entry/commands), `previewManager.ts`, `markdownEngine.ts`, `scrollSync.ts`, `checkboxHandler.ts`.
- `webview/` — browser sandbox: `main.ts`, `renderer.ts`, DOM handlers. Strict CSP: nonced scripts only, `unsafe-eval` solely because Mermaid requires it.
- `src/types/messages.ts` + `webview/types/` — the message protocol, mirrored on both sides.
- `dist/` — build output; `docs/` — docs + landing page; `scripts/generate-landing.cjs` — landing generator.
- Full map and message flows: `docs/ARCHITECTURE.md`; protocol reference: `docs/API.md`.

## Constraints

- `npm run build:landing` **rewrites the tracked file `docs/index.html`** — running it dirties the tree; commit the regeneration deliberately or `git checkout -- docs/index.html` to discard.
- A new host↔webview message needs its type added to **both** `src/types/messages.ts` and `webview/types/`, plus a handler in each process.
- Work on a branch and open a PR — no direct commits to `main`.

## Conventions

- Webpack emits two bundles: `dist/extension.js` (CommonJS/Node) and `dist/webview/main.js` + `main.css`; vendor assets are copied to `dist/webview/vendor/`.
- Prettier and ESLint are the style authority — never hand-tune formatting they enforce.

## Done when

- `npm run lint`, `npm run format:check`, and both `tsc --noEmit` invocations pass.
- Behavior changes verified in the Extension Development Host (`F5`).

## Read when needed

- Architecture / message flow → `docs/ARCHITECTURE.md`
- Environment, full command reference, gotchas → `docs/DEVELOPMENT.md`
- Message protocol → `docs/API.md`
- Marketplace publishing → `docs/DEPLOYMENT.md` or the `vscode-extension-publisher` skill
