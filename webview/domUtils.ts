export function createButton(
  icon: string,
  title: string,
  onClick: () => void,
  label?: string
): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'toolbar-button';
  button.innerHTML = icon;
  button.title = title;
  // Icon-only buttons have no text content, so give every button an
  // accessible name.
  button.setAttribute('aria-label', title);
  if (label) {
    // Persistent text label for the buttons that need to be told apart at a
    // glance (e.g. the two export actions).
    button.classList.add('toolbar-button--labeled');
    const labelEl = document.createElement('span');
    labelEl.className = 'toolbar-button-label';
    labelEl.textContent = label;
    button.appendChild(labelEl);
  } else {
    // Icon-only buttons surface their label on hover/focus via the CSS
    // [data-label] tooltip instead of waiting on the native title tooltip.
    button.dataset.label = title;
  }
  button.addEventListener('click', onClick);
  return button;
}

export function createSeparator(): HTMLElement {
  const sep = document.createElement('div');
  sep.className = 'toolbar-separator';
  return sep;
}
