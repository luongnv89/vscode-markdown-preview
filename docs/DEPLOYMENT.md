# Deployment

## Packaging the Extension

### Build the VSIX

```bash
npm run package
npx @vscode/vsce package --no-dependencies
```

This produces a `.vsix` file (e.g., `markdown-preview-pro-0.1.0.vsix`).

### Install Locally

```bash
code --install-extension markdown-preview-pro-*.vsix
```

## Releasing (automated)

The `Release` workflow (`.github/workflows/release.yml`) runs on every pushed
`v*` tag and:

1. Verifies the tag's version matches `package.json` (the pre-release suffix is
   ignored, so `v0.9.6-rc1` still validates against `0.9.6`).
2. Runs the full test suite (`xvfb-run -a npm test`).
3. Builds and packages the `.vsix`.
4. Extracts the `## [x.y.z]` section matching the tag's base version from
   `CHANGELOG.md` and creates a GitHub release with those notes and the `.vsix`
   attached (tags containing a `-` suffix are marked as pre-releases).
5. Publishes the `.vsix` to the VS Code Marketplace — only when the `VSCE_PAT`
   repository secret is set (see below); otherwise the step is skipped.

To cut a release:

```bash
# Bump the version and update CHANGELOG.md first
npm version patch   # or minor / major — then commit and merge to main

git tag v0.9.6
git push origin v0.9.6
```

The workflow fails fast when the tag does not match `package.json`, and warns
when `CHANGELOG.md` has no matching section (falling back to GitHub-generated
notes) — always add a `## [x.y.z]` section for the version being tagged.

### Marketplace publishing secret

Publishing requires an Azure DevOps Personal Access Token with **Marketplace >
Manage** scope for all accessible organizations (see
`.agents/skills/vscode-extension-publisher/` for the full setup guide). Store it
as a repository secret named `VSCE_PAT` under **Settings > Secrets and
variables > Actions**. Without it the workflow still produces the GitHub
release and `.vsix` asset.

## Publishing to VS Code Marketplace (manual)

### Prerequisites

1. A [Visual Studio Marketplace](https://marketplace.visualstudio.com/) publisher account
2. A Personal Access Token (PAT) from [Azure DevOps](https://dev.azure.com/)

### Steps

1. Login to vsce:

   ```bash
   npx @vscode/vsce login <publisher-name>
   ```

2. Publish:
   ```bash
   npx @vscode/vsce publish
   ```

### Version Bump

Update the version in `package.json` before publishing:

```bash
# Patch release (0.1.0 → 0.1.1)
npm version patch

# Minor release (0.1.0 → 0.2.0)
npm version minor

# Major release (0.1.0 → 1.0.0)
npm version major
```

## Distribution via GitHub Releases

Tags pushed as `v*` trigger the automated release above. Users can install via
the one-liner:

```bash
curl -sSL https://raw.githubusercontent.com/luongnv89/vscode-markdown-preview/main/install.sh | bash
```

## GitHub Pages Landing Page

Live at: **https://luongnv.com/vscode-markdown-preview/**

This repo also ships a single-file landing page generated from Markdown using the extension's own markdown rendering/export stack.

### Source and build

- Source markdown: `docs/landing.md`
- Generated HTML: `docs/index.html` (gitignored — built on demand, never committed)
- Generator: `scripts/generate-landing.cjs`

Build it locally with:

```bash
npm ci
npm run package
npm run build:landing
```

### CI/CD behavior

- `CI` installs dependencies, checks formatting/lint/types, builds the extension, and smoke-builds the landing page to prove the generator still runs. `docs/index.html` is not tracked, so no step compares it against the commit.
- `Deploy landing page` regenerates `docs/index.html` in the workflow and publishes the standalone page to **GitHub Pages** on every push to `main`.
- The Pages workflow deploys a root artifact containing the self-contained `index.html` only.

## Files Included in Package

The `.vscodeignore` file controls what gets included in the `.vsix`. Only these are packaged:

- `dist/` - Compiled JavaScript and CSS
- `media/` - Extension icon
- `package.json` - Extension manifest
- `LICENSE` - License file
- `README.md` - Extension description (shown in Marketplace)
