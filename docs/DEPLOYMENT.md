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

## Publishing to VS Code Marketplace

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

1. Tag the release:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

2. Create a GitHub release and attach the `.vsix` file

3. Users can install via the one-liner:
   ```bash
   curl -sSL https://raw.githubusercontent.com/luongnv89/vscode-markdown-preview/main/install.sh | bash
   ```

## Files Included in Package

The `.vscodeignore` file controls what gets included in the `.vsix`. Only these are packaged:

- `dist/` - Compiled JavaScript and CSS
- `media/` - Extension icon
- `package.json` - Extension manifest
- `LICENSE` - License file
- `README.md` - Extension description (shown in Marketplace)
