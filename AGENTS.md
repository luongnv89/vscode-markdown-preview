# AGENTS.md — Markdown Preview Pro

Agent/subagent contract for this repo. Build, lint, typecheck, and test commands live in `CLAUDE.md` (and `docs/DEVELOPMENT.md`) — read them there; they are deliberately not restated here.

## Project

- VS Code extension (`markdown-preview-pro`): rich markdown preview via a two-process split — extension host (`src/`) ↔ webview (`webview/`) over `postMessage`.
- Invariant that must not break: every host↔webview message stays inside the typed protocol (`src/types/messages.ts` + `webview/types/`).

## Commands

- All commands → `CLAUDE.md` § Commands, canonical notes → `docs/DEVELOPMENT.md`. Single source, no copy here.

## Subagents and skills in this repo

- `vscode-extension-publisher` (`.agents/skills/vscode-extension-publisher/`, mirrored at `.claude/skills/vscode-extension-publisher/`) — guided VS Code Marketplace publishing: vsce packaging, PAT/publisher setup, pre-flight checks, GitHub Actions release workflow. Use it for anything publish/release-related; never hand-roll a release.
- No `.claude/agents/*.md` subagent definitions exist yet — when one is added, list it here with its trigger conditions.

## Delegation etiquette

- Isolated research or audit work → delegate to a subagent; only the summary returns to the main context.
- Multi-step procedures → invoke the matching skill (e.g. `vscode-extension-publisher`); never inline a runbook into conversation or this file.
- Keep the main context lean: prefer targeted search over whole-file reads; batch related edits into one operation.
- One rule, one home: agent-behavior rules live here, project commands/architecture pins live in `CLAUDE.md`. `CLAUDE.md` opens with `@AGENTS.md`, so this file loads in Claude sessions too — never duplicate a rule across the pair.

## Constraints

- Never hand-edit generated output: `dist/`, `docs/index.html` (regenerate via the documented commands in `CLAUDE.md`).
- No direct commits to `main` — branch and PR.

## Token Efficiency

- Never re-read files you just wrote or edited. You know the contents.
- Never re-run commands to "verify" unless the outcome was uncertain.
- Don't echo back large blocks of code or file contents unless asked.
- Batch related edits into single operations. Don't make 5 edits when 1 handles it.
- Skip confirmations like "I'll continue..." Just do it.
- If a task needs 1 tool call, don't use 3. Plan before acting.
- Do not summarize what you just did unless the result is ambiguous or you need additional input.
