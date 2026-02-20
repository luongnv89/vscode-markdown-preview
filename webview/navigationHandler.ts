export function initNavigationHandler(vscode: VsCodeApi): void {
  // Double-click to navigate to source line
  document.addEventListener('dblclick', (e) => {
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
  });

  // Handle link clicks
  document.addEventListener('click', (e) => {
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
  });
}
