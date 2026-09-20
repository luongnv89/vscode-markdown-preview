export function createButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'toolbar-button';
  button.innerHTML = icon;
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
}

export function createSeparator(): HTMLElement {
  const sep = document.createElement('div');
  sep.className = 'toolbar-separator';
  return sep;
}
