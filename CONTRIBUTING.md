# Contributing to Markdown Preview Pro

Thank you for your interest in contributing! This guide will help you get started.

## How to Contribute

1. **Fork** the repository
2. **Create** a feature branch from `main`
3. **Make** your changes
4. **Test** your changes thoroughly
5. **Submit** a pull request

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [VS Code](https://code.visualstudio.com/) >= 1.85.0
- [Git](https://git-scm.com/)

### Getting Started

```bash
# Clone your fork
git clone https://github.com/<your-username>/vscode-markdown-preview.git
cd vscode-markdown-preview

# Install dependencies
npm install

# Build the extension
npm run compile

# Watch for changes during development
npm run watch
```

### Running the Extension

1. Open the project in VS Code
2. Press `F5` to launch the Extension Development Host
3. Open any `.md` file and use `Cmd+Shift+V` / `Ctrl+Shift+V` to preview

### Project Architecture

The extension uses a two-process architecture:

- **Extension Host** (`src/`) - Runs in Node.js, handles VS Code integration and markdown parsing
- **Webview** (`webview/`) - Runs in an isolated browser context, handles rendering and user interactions

Communication between the two happens via VS Code's message passing API.

## Branching Strategy

- `main` - Stable, release-ready code
- `feat/<name>` - New features
- `fix/<name>` - Bug fixes
- `docs/<name>` - Documentation changes

Always branch from `main`:

```bash
git checkout main
git pull origin main
git checkout -b feat/my-feature
```

## Commit Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
```

**Types:**

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `style` - Formatting, no code change
- `refactor` - Code restructuring
- `test` - Adding or updating tests
- `chore` - Build process, dependencies

**Examples:**

```
feat(mermaid): add support for gantt charts
fix(scroll): correct sync offset for code blocks
docs: update configuration table in README
```

## Pull Request Process

1. Update documentation if your changes affect usage
2. Ensure the extension builds without errors (`npm run compile`)
3. Test the extension in the Extension Development Host
4. Fill out the PR template completely
5. Request review from a maintainer

### PR Guidelines

- Keep PRs focused on a single change
- Write clear descriptions of what and why
- Reference related issues with `Fixes #123`

## Coding Standards

- **TypeScript** for all source code
- Use the existing code style (check `tsconfig.json` settings)
- Prefer `const` over `let`, avoid `var`
- Use meaningful variable and function names
- Keep functions small and focused

## Testing

```bash
# Run tests
npm test

# Lint code
npm run lint
```

## Reporting Issues

- Use the [bug report template](https://github.com/luongnv89/vscode-markdown-preview/issues/new?template=bug_report.md) for bugs
- Use the [feature request template](https://github.com/luongnv89/vscode-markdown-preview/issues/new?template=feature_request.md) for ideas

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). Please read it before participating.

## Questions?

Open a [discussion](https://github.com/luongnv89/vscode-markdown-preview/discussions) or reach out by creating an issue.
