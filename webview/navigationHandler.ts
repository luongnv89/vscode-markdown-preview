// Double-click navigates to the source line recorded in data-line — unless the
// target is interactive (link, checkbox, copy button, toolbar).
function handleNavigateDoubleClick(vscode: VsCodeApi, e: MouseEvent): void {
  const target = e.target as HTMLElement;

  // Don't navigate if double-clicking on a link, checkbox, or code block copy button
  if (
    target.tagName === 'A' ||
    target.tagName === 'INPUT' ||
    target.closest('.copy-button') ||
    target.closest('a') ||
    target.closest('.preview-toolbar')
  ) {
    return;
  }

  const lineElement = target.closest('[data-line]');
  if (!lineElement) {
    return;
  }

  const line = parseInt(lineElement.getAttribute('data-line') || '-1', 10);
  if (line < 0) {
    return;
  }

  vscode.postMessage({
    type: 'navigateToLine',
    line,
  });
}

// External links open through the host — the webview cannot navigate itself.
function handleLinkClick(vscode: VsCodeApi, e: MouseEvent): void {
  const target = e.target as HTMLElement;
  const link = target.closest('a');

  if (!link) {
    return;
  }

  const href = link.getAttribute('href');
  if (!href) {
    return;
  }

  // External links
  if (href.startsWith('http://') || href.startsWith('https://')) {
    e.preventDefault();
    vscode.postMessage({
      type: 'openLink',
      href,
    });
  }
}

export function initNavigationHandler(vscode: VsCodeApi): void {
  // Double-click to navigate to source line
  document.addEventListener('dblclick', (e) => handleNavigateDoubleClick(vscode, e));

  // Handle link clicks
  document.addEventListener('click', (e) => handleLinkClick(vscode, e));
}
