# MAJORS.md — M2 major-currency rationale

Record for milestone **M2** (exit condition: _every major current or deferred with written
rationale_), produced by Task 5.5. For each upgrade wave of the modernization program the
version now installed, the action taken, and — for anything not taken to latest — the reason
and the revisit trigger. Waves are numbered per the `MODERNIZATION_REPORT.md` wave table
(W1–W12); W3–W12 are the P2 majors this milestone gates on, W1–W2 landed earlier in P1 and are
listed for completeness.

**Measured at:** `main` (post PR #116) · `npm outdated` → `{}` — every direct dependency is at
the registry's latest version · `npm audit --audit-level=high` exits 0 · `npm test` 112/112.

## Wave ledger

| Wave | Package / surface                                                  | Action                                     | Installed                                                 | Latest  | Status                                                      |
| ---- | ------------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------- | ------- | ----------------------------------------------------------- |
| W1   | 9 high advisories + `yauzl` override                               | patched in P1 (PR #92)                     | n/a — patch/minor                                         | —       | done                                                        |
| W2   | `F-DEP-010` patch/minor batch + `pre-commit-hooks` v4.5.0 → v6.0.0 | shipped in P1 (PRs #93, #94)               | n/a — patch/minor                                         | —       | done                                                        |
| W3   | Node.js runtime                                                    | 20 → **24 LTS** (PR #104)                  | 24 (`.nvmrc`, `engines.node >=24`, CI `node-version: 24`) | 24 LTS  | current                                                     |
| W3   | `actions/checkout`                                                 | v4 → v7, SHA-pinned (PRs #105, #107)       | `3d3c42e` `# v7`                                          | v7      | current                                                     |
| W3   | `actions/setup-node`                                               | v4 → v7, SHA-pinned (PRs #105, #107)       | `8207627` `# v7`                                          | v7      | current                                                     |
| W3   | `actions/upload-artifact`                                          | v4 → v7, SHA-pinned (PRs #105, #107)       | `043fb46` `# v7`                                          | v7      | current                                                     |
| W3   | `actions/configure-pages`                                          | v5 → v6, SHA-pinned (PRs #106, #107)       | `45bfe01` `# v6`                                          | v6      | current                                                     |
| W3   | `actions/upload-pages-artifact`                                    | v3 → v5, SHA-pinned (PRs #106, #107)       | `fc324d3` `# v5`                                          | v5      | current                                                     |
| W3   | `actions/deploy-pages`                                             | v4 → v5, SHA-pinned (PRs #106, #107)       | `368f825` `# v5`                                          | v5      | current                                                     |
| W3   | all 8 workflow refs                                                | mutable `@vN` tags → commit SHAs (PR #107) | SHA-pinned                                                | —       | current                                                     |
| W4   | `puppeteer-core`                                                   | 24.43.1 → 25.11.0 (PR #113)                | 25.11.0                                                   | 25.11.0 | current — clears the last high advisory (extract-zip chain) |
| W5   | `mermaid`                                                          | 11 → 12.0.0 (PR #114)                      | 12.0.0                                                    | 12.0.0  | current                                                     |
| W6   | `markdown-it`                                                      | 14 → 15.0.2 (PR #114)                      | 15.0.2                                                    | 15.0.2  | current                                                     |
| W7   | `katex`                                                            | 0.16.47 → 0.18.7 (PR #114)                 | 0.18.7                                                    | 0.18.7  | current — see nested-pin residual below                     |
| W8   | `@types/node`                                                      | 20.19.33 → 26.6.2 (PR #115)                | 26.6.2                                                    | 26.6.2  | current                                                     |
| W9   | `typescript`                                                       | 5.9.3 → 7.0.2 (PR #115)                    | 7.0.2                                                     | 7.0.2   | current — native port; toolchain decision below             |
| W10  | `webpack-cli`                                                      | 5.1.4 → 7.2.3 (PR #116)                    | 7.2.3                                                     | 7.2.3   | current                                                     |
| W11  | `css-loader`                                                       | 6.11.0 → 7.1.5 (PR #116)                   | 7.1.5                                                     | 7.1.5   | current                                                     |
| W12  | `style-loader`, `markdown-it-task-lists`                           | **removed, not bumped** (PR #116)          | absent from `package.json` + lockfile                     | n/a     | closed — rationale below                                    |

## W9 toolchain decision — TypeScript 7

TypeScript 7 is the native port (`tsgo`); landing it changed the toolchain around it, recorded
in PR #115's decision record:

- **`ts-loader` removed → `esbuild-loader ^4.5.0`** compiles TS inside webpack (ts-loader is
  not TS7-compatible).
- **`eslint` + `typescript-eslint` removed → `oxlint ^1.83.0`** lints `src/` and `webview/`
  (`typescript-eslint`'s peer range `<6.1.0` excludes TS 7). `.eslintrc.json` /
  `eslint.config.mjs` are gone; `.oxlintrc.json` is the lint config.
- **Revert path:** pin `typescript ^5`, restore `ts-loader` in `webpack.config.js`, restore
  the eslint flat config, and drop `esbuild-loader`/`oxlint` — the pre-#115 tree (`main` at
  PR #114) is the reference state.

## W12 — removed rather than bumped

The plan scheduled a `style-loader` 3 → 4 major bump; execution found the package **unreferenced**
(`webpack.config.js` uses `MiniCssExtractPlugin.loader` + `css-loader`; `git grep style-loader`
matched only `package.json` and the lockfile), so Task 5.4 removed it instead of upgrading it.
`markdown-it-task-lists` was likewise unreferenced — both engines register a hand-rolled
`task-lists` rule — and was removed in the same change. **Revisit trigger:** if a `style-loader`
rule is ever added to the webpack config, or task lists move back to the plugin, install at the
then-current major.

## Not at latest — reasons and revisit triggers

`npm outdated` reports no direct dependency behind latest, so no ledger row needs a deferral.
Two known residuals are recorded for honesty — neither is a direct dependency:

| Item                                 | State                           | Reason                                                                                        | Revisit trigger                                                                      |
| ------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `mermaid/node_modules/katex@0.16.47` | nested transitive pin, expected | mermaid 12 bundles its own katex ~0.16; the direct dep is 0.18.7                              | a mermaid release that bumps its katex pin, or an advisory against the nested 0.16.x |
| `install.sh` `MIN_NODE_VERSION=18`   | stale vs `engines.node >=24`    | installer floor never bumped alongside the W3 runtime move; known residual, not yet scheduled | the next `install.sh` change, or a scheduled installer-correctness issue             |

## Verification

- `npm outdated --json` → `{}` — no direct dependency absent from this file (AC: the check in
  Task 5.5 greps each outdated name against `MAJORS.md`; the set is empty at record date).
- `npm test` — 112/112, at/above the Task 0.3 recorded rate (doc-only change).
- `npm audit --audit-level=high` — exit 0.
