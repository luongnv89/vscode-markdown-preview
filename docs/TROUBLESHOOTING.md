# Troubleshooting

Common issues and solutions when using or developing Markdown Preview Pro.

## Preview Issues

### Preview panel is blank

**Symptoms:** The preview panel opens but shows nothing.

**Solutions:**
1. Open the webview DevTools (Command Palette → **Developer: Open Webview Developer Tools**) and check the console for errors
2. Ensure the extension is built: run `npm run compile`
3. Reload the VS Code window: `Cmd+Shift+P` → **Developer: Reload Window**

### Preview not updating on save

**Symptoms:** Edits to the markdown file are not reflected in the preview.

**Solutions:**
1. Make sure `npm run watch` is running if you're developing
2. Check that the preview is showing the correct file (title bar shows the filename)
3. Switching to a different file and back can trigger a re-render

### Content Security Policy errors

**Symptoms:** Console shows CSP violation warnings, some content doesn't render.

**Solutions:**
- This is expected for inline scripts or styles from external sources
- Local images must be in the workspace folder or the document's directory
- Remote images over `https://` are allowed; `http://` images are blocked

## Mermaid Diagrams

### Diagram shows "Mermaid diagram error"

**Symptoms:** A red error message appears instead of the diagram.

**Solutions:**
1. Verify the diagram syntax at [Mermaid Live Editor](https://mermaid.js.org/docs/community/n00b-syntaxReference.html)
2. Ensure the code block uses the `mermaid` language identifier:
   ````
   ```mermaid
   graph TD
       A --> B
   ```
   ````
3. Check for unsupported diagram types - Mermaid v10 supports: flowchart, sequence, class, state, ER, journey, gantt, pie, mindmap, timeline, quadrant, sankey, xy, block

### Diagram renders with wrong colors

**Symptoms:** Diagram theme doesn't match your VS Code theme.

**Solutions:**
- Switch your VS Code theme, then switch back - this triggers a re-render
- Mermaid auto-detects `vscode-dark` and `vscode-high-contrast` body classes
- Reload the window if theme detection fails

### Mermaid not rendering at all

**Symptoms:** Raw mermaid code is displayed instead of a diagram.

**Solutions:**
1. Ensure `markdownPreviewPro.enableMermaid` is `true` in settings
2. Open webview DevTools and check if `mermaid` is available on `window`
3. Rebuild the extension: `npm run compile`

## KaTeX Math

### Math not rendering

**Symptoms:** Raw LaTeX syntax (`$E = mc^2$`) shows instead of rendered math.

**Solutions:**
1. Ensure `markdownPreviewPro.enableKatex` is `true` in settings
2. Check syntax: inline math uses single `$...$`, block math uses `$$...$$`
3. Don't put spaces right after the opening `$` or before the closing `$`:
   - Correct: `$E = mc^2$`
   - Incorrect: `$ E = mc^2 $`

### KaTeX parse error

**Symptoms:** Math shows an error message or raw text fallback.

**Solutions:**
- KaTeX uses `throwOnError: false` so it will show the raw text on errors
- Validate your LaTeX syntax at [KaTeX Supported Functions](https://katex.org/docs/supported)
- Escape special characters: use `\$` for a literal dollar sign

### Block math not detected

**Symptoms:** `$$...$$` displays as text instead of rendered math.

**Solutions:**
- `$$` must be on its own line:
  ```
  $$
  \int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
  $$
  ```
- Don't put content on the same line as the opening `$$`

## Scroll Sync

### Scroll sync feels laggy or jumpy

**Symptoms:** Preview and editor scroll positions drift apart.

**Solutions:**
- Scroll sync uses a 300ms lock to prevent feedback loops - small delays are expected
- The sync maps `data-line` attributes on block-level HTML elements to source lines
- Long inline content (e.g., large tables) may not map precisely

### Scroll sync not working

**Symptoms:** Editor and preview scroll independently.

**Solutions:**
1. Ensure `markdownPreviewPro.scrollSync` is `true`
2. The sync only works when the active editor matches the previewed file
3. Embedded HTML blocks without `data-line` attributes won't have sync targets

## Task Lists / Checkboxes

### Checkboxes not clickable

**Symptoms:** Clicking a checkbox in the preview does nothing.

**Solutions:**
1. Ensure `markdownPreviewPro.enableCheckboxes` is `true`
2. The source file must not be read-only
3. Task list syntax must be correct: `- [ ] Task` or `- [x] Task`

### Checkbox state not persisting

**Symptoms:** Checkbox reverts after clicking.

**Solutions:**
- The extension modifies the source file via a workspace edit
- If the file has unsaved changes, check that auto-save is enabled or save manually
- Check for file permission issues

## Images

### Local images not displaying

**Symptoms:** Broken image icon appears in preview.

**Solutions:**
1. Use relative paths from the markdown file's location: `![Alt](./images/photo.png)`
2. The image must be within the workspace folder or document directory (enforced by `localResourceRoots`)
3. Absolute file paths are not supported - use relative paths
4. Check the webview DevTools console for CSP or 404 errors

### Excalidraw diagrams not rendering

**Symptoms:** Excalidraw `.excalidraw` files show as broken images.

**Solutions:**
- Export the Excalidraw diagram as `.excalidraw.png` or `.excalidraw.svg`
- Raw `.excalidraw` JSON files cannot be rendered as images

## Development Issues

### Build errors after pulling changes

```bash
rm -rf node_modules dist
npm install
npm run compile
```

### TypeScript errors in webview code

The webview uses a separate TypeScript config (`tsconfig.webview.json`) targeting browser APIs. Ensure you're not importing Node.js modules in `webview/` files.

### "Cannot find module" errors

```bash
npm install
```

If the error persists, check that the import path is correct and the module is listed in `package.json` dependencies.

## Performance

### Preview is slow with large files

- Content updates are debounced at 300ms
- Mermaid diagrams are the most expensive render operation
- Consider disabling Mermaid (`enableMermaid: false`) for very large files
- Syntax highlighting with auto-detection can be slower - specify language in code blocks

### High memory usage

- The extension uses `retainContextWhenHidden: true` to preserve webview state
- Each preview panel keeps a full DOM in memory
- Close unused preview panels to free memory

## Related Docs

- [Development](DEVELOPMENT.md) - Debug setup and workflow
- [Architecture](ARCHITECTURE.md) - How the extension works
- [API Reference](API.md) - Internal module documentation
