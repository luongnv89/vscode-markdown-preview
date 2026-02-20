const sunIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="5"/>
  <line x1="12" y1="1" x2="12" y2="3"/>
  <line x1="12" y1="21" x2="12" y2="23"/>
  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
  <line x1="1" y1="12" x2="3" y2="12"/>
  <line x1="21" y1="12" x2="23" y2="12"/>
  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
</svg>`;

const moonIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
</svg>`;

const pdfIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
  <line x1="9" y1="15" x2="15" y2="15"/>
  <line x1="9" y1="11" x2="15" y2="11"/>
</svg>`;

const htmlIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="16 18 22 12 16 6"/>
  <polyline points="8 6 2 12 8 18"/>
</svg>`;

function detectInitialTheme(): 'light' | 'dark' {
  if (
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast')
  ) {
    return 'dark';
  }
  return 'light';
}

function createButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'toolbar-button';
  button.innerHTML = icon;
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
}

export function initToolbar(vscode: VsCodeApi): void {
  const toolbar = document.createElement('div');
  toolbar.className = 'preview-toolbar';

  let currentTheme = detectInitialTheme();

  const themeButton = createButton(
    currentTheme === 'dark' ? sunIcon : moonIcon,
    currentTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
    () => {
      if (currentTheme === 'dark') {
        document.body.classList.remove('preview-theme-dark');
        document.body.classList.add('preview-theme-light');
        currentTheme = 'light';
        themeButton.innerHTML = moonIcon;
        themeButton.title = 'Switch to dark theme';
      } else {
        document.body.classList.remove('preview-theme-light');
        document.body.classList.add('preview-theme-dark');
        currentTheme = 'dark';
        themeButton.innerHTML = sunIcon;
        themeButton.title = 'Switch to light theme';
      }
    }
  );

  const pdfButton = createButton(pdfIcon, 'Export to PDF', () => {
    vscode.postMessage({ type: 'exportToPdf' });
  });

  const htmlButton = createButton(htmlIcon, 'Export to HTML', () => {
    vscode.postMessage({ type: 'exportToHtml' });
  });

  toolbar.appendChild(themeButton);
  toolbar.appendChild(pdfButton);
  toolbar.appendChild(htmlButton);

  document.body.appendChild(toolbar);
}
