/**
 * Detect whether the preview is currently in a dark theme. An explicit
 * `preview-theme-dark` overlay wins; an explicit `preview-theme-light`
 * overlay forces light. When neither pin is present, follow VS Code's
 * `vscode-dark` / `vscode-high-contrast` host classes only.
 */

// True until the toolbar toggle pins a preview-theme-* overlay. watchThemeChanges
// consults this so a host class swap (e.g. GitHub Dark) can drop a stale pin.
let followsHost = true;

export function setThemeFollowsHost(follow: boolean): void {
  followsHost = follow;
}

export function themeFollowsHost(): boolean {
  return followsHost;
}

export function isDarkTheme(): boolean {
  if (document.body.classList.contains('preview-theme-dark')) {
    return true;
  }
  if (document.body.classList.contains('preview-theme-light')) {
    return false;
  }
  return (
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast')
  );
}
