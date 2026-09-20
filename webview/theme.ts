/**
 * Detect whether the preview is currently in a dark theme. An explicit
 * `preview-theme-dark` override wins; otherwise fall back to the VS Code theme
 * classes unless `preview-theme-light` was applied.
 */
export function isDarkTheme(): boolean {
  return (
    document.body.classList.contains('preview-theme-dark') ||
    (!document.body.classList.contains('preview-theme-light') &&
      (document.body.classList.contains('vscode-dark') ||
        document.body.classList.contains('vscode-high-contrast')))
  );
}
