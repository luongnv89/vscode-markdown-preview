@AGENTS.md

# CLAUDE.md — Markdown Preview Pro

## Project

- VS Code extension (`markdown-preview-pro`): markdown preview with syntax highlighting, Mermaid, KaTeX, Excalidraw, interactive checkboxes, scroll sync, HTML/PDF export.
- Two-process architecture: extension host (`src/`, Node.js) ↔ webview (`webview/`, browser sandbox) over `postMessage`. Invariant: all host↔webview traffic goes through the typed message protocol — never bypass it.

## Commands

- Install: `npm ci` — Node 24 (the CI pin, also in `.nvmrc`; `engines.node` declares `>=24.0.0`) or newer LTS; no `.env.example` exists.
- Dev build: `npm run compile` — one-time Webpack build into `dist/` (`npm run watch` for rebuild-on-change).
- Production build: `npm run package` — optimized bundle with hidden source maps.
- Lint: `npm run lint` — oxlint over `src/` and `webview/` (config `.oxlintrc.json`).
- Format gate: `npm run format:check` — Prettier check, same as CI.
- Typecheck — run **both**, CI does:
  - `npx tsc --noEmit -p tsconfig.json` (extension host, `src/`)
  - `npx tsc --noEmit -p tsconfig.webview.json` (webview, `webview/`)
- Test: `npm test` — the `pretest` hook builds the extension (`webpack`) and compiles `src/test/` to `out/test/` via `tsconfig.test.json` (imported `src/` modules are loose-compiled under `out/` too), then `out/test/runTest.js` launches an Extension Development Host through `@vscode/test-electron` and runs the Mocha suite in `src/test/suite/`. Baseline pass rate: **35/35** — this is the recorded baseline every subsequent task asserts against.
- Coverage: `npm run coverage` — same build + Electron run as `npm test`, wrapped by `c8` (config: `.c8rc.json`; scope: `src/**` minus `src/test/**`; output: `coverage/`, gitignored). Recorded line coverage: **87.06%** — raised from the 9.75% pre-improvement baseline; `.c8rc.json` enforces `check-coverage` with `lines: 87`, so `npm run coverage` (and the CI step running it) fails if line coverage regresses below the measured figure.
- Debug: `F5` in VS Code launches the Extension Development Host (`.vscode/launch.json`).

## Layout

- `src/` — extension host: `extension.ts` (entry/commands), `previewManager.ts`, `markdownEngine.ts`, `scrollSync.ts`, `checkboxHandler.ts`.
- `webview/` — browser sandbox: `main.ts`, `renderer.ts`, DOM handlers. Strict CSP: nonced scripts only, `unsafe-eval` solely because Mermaid requires it.
- `src/types/messages.ts` + `webview/types/` — the message protocol, mirrored on both sides.
- `dist/` — build output; `docs/` — docs + landing page; `scripts/generate-landing.cjs` — landing generator.
- Full map and message flows: `docs/ARCHITECTURE.md`; protocol reference: `docs/API.md`.

## Constraints

- `npm run build:landing` **writes the generated file `docs/index.html`** — it is gitignored (the Pages workflow regenerates it), so running it never dirties the tree and its output is never committed.
- A new host↔webview message needs its type added to **both** `src/types/messages.ts` and `webview/types/`, plus a handler in each process.
- Work on a branch and open a PR — no direct commits to `main`.

## Conventions

- Webpack emits three bundles: `dist/extension.js` (CommonJS/Node — export-only deps like jsdom/puppeteer-core stay behind `await import()` as lazy `dist/*.extension.js` chunks), `dist/markdownCore.js` (CommonJS shared engine, consumed by `scripts/generate-landing.cjs`), and `dist/webview/main.js` + `main.css`; vendor assets are copied to `dist/webview/vendor/`.
- Prettier and oxlint are the style authority — never hand-tune formatting they enforce.

## Done when

- `npm run lint`, `npm run format:check`, and both `tsc --noEmit` invocations pass.
- Behavior changes verified in the Extension Development Host (`F5`).

## Read when needed

- Architecture / message flow → `docs/ARCHITECTURE.md`
- Environment, full command reference, gotchas → `docs/DEVELOPMENT.md`
- Message protocol → `docs/API.md`
- Marketplace publishing → `docs/DEPLOYMENT.md` or the `vscode-extension-publisher` skill
