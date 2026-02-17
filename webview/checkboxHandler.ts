export function initCheckboxHandler(vscode: VsCodeApi): void {
  document.addEventListener('change', (e) => {
    const target = e.target as HTMLElement;

    if (target.tagName === 'INPUT' && target.getAttribute('type') === 'checkbox') {
      const line = parseInt(target.getAttribute('data-line') || '-1', 10);
      if (line < 0) {
        return;
      }

      const checked = (target as HTMLInputElement).checked;

      vscode.postMessage({
        type: 'toggleCheckbox',
        line,
        checked,
      });
    }
  });
}
