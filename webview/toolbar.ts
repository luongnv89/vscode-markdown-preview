import { toggleToc, setTocToggleButton } from './toc';
import { toggleStats, setStatsToggleButton } from './statsBar';
import { enterPresentation } from './presentation';
import { isDarkTheme, setThemeFollowsHost } from './theme';
import { createButton, createSeparator } from './domUtils';
import { createAboutButton } from './aboutPopup';
import {
  sunIcon,
  moonIcon,
  pdfIcon,
  htmlIcon,
  listIcon,
  barChartIcon,
  presentationIcon,
} from './icons';

type PreviewTheme = 'light' | 'dark';

// Shared with watchThemeChanges so a follow-host vscode-dark swap can rewrite
// the toggle chrome — currentTheme used to live only in the click closure.
let currentTheme: PreviewTheme = 'light';
let themeButtonEl: HTMLButtonElement | undefined;

function themeIcon(theme: PreviewTheme): string {
  return theme === 'dark' ? sunIcon : moonIcon;
}

function themeActionLabel(theme: PreviewTheme): string {
  return theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
}

function syncThemeButtonChrome(): void {
  if (!themeButtonEl) {
    return;
  }
  themeButtonEl.innerHTML = themeIcon(currentTheme);
  const label = themeActionLabel(currentTheme);
  themeButtonEl.title = label;
  themeButtonEl.setAttribute('aria-label', label);
  themeButtonEl.dataset.label = label;
  themeButtonEl.setAttribute('aria-pressed', String(currentTheme === 'dark'));
}

export function syncThemeButtonFromHost(): void {
  currentTheme = isDarkTheme() ? 'dark' : 'light';
  syncThemeButtonChrome();
}

function applyTheme(theme: PreviewTheme): void {
  document.body.classList.toggle('preview-theme-dark', theme === 'dark');
  document.body.classList.toggle('preview-theme-light', theme === 'light');
}

function clearThemeOverlay(): void {
  document.body.classList.remove('preview-theme-dark', 'preview-theme-light');
}

// The manual toggle's choice survives panel reloads via vscode.setState —
// merged so the scroll position main.ts persists is never clobbered.
function persistTheme(vscode: VsCodeApi, theme: PreviewTheme): void {
  vscode.setState({ ...vscode.getState(), theme });
}

// A persisted manual choice is an explicit overlay; undefined means follow-host.
function persistedTheme(vscode: VsCodeApi): PreviewTheme | undefined {
  const persisted = vscode.getState()?.theme;
  if (persisted === 'dark' || persisted === 'light') {
    return persisted;
  }
  return undefined;
}

function createThemeButton(vscode: VsCodeApi, initial: PreviewTheme): HTMLButtonElement {
  currentTheme = initial;
  const themeButton = createButton(themeIcon(currentTheme), themeActionLabel(currentTheme), () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setThemeFollowsHost(false);
    applyTheme(currentTheme);
    persistTheme(vscode, currentTheme);
    syncThemeButtonChrome();
  });
  themeButtonEl = themeButton;
  syncThemeButtonChrome();
  return themeButton;
}

function createExportButtons(vscode: VsCodeApi): {
  pdfButton: HTMLButtonElement;
  htmlButton: HTMLButtonElement;
} {
  const pdfButton = createButton(
    pdfIcon,
    'Export to PDF',
    () => {
      vscode.postMessage({ type: 'exportToPdf' });
    },
    'PDF'
  );
  const htmlButton = createButton(
    htmlIcon,
    'Export to HTML',
    () => {
      vscode.postMessage({ type: 'exportToHtml' });
    },
    'HTML'
  );
  return { pdfButton, htmlButton };
}

export function initToolbar(vscode: VsCodeApi): void {
  const toolbar = document.createElement('div');
  toolbar.className = 'preview-toolbar';

  const override = persistedTheme(vscode);
  if (override) {
    setThemeFollowsHost(false);
    applyTheme(override);
  } else {
    setThemeFollowsHost(true);
    clearThemeOverlay();
  }
  const startTheme = override ?? (isDarkTheme() ? 'dark' : 'light');

  const tocButton = createButton(listIcon, 'Toggle Table of Contents', toggleToc);
  setTocToggleButton(tocButton);

  const statsButton = createButton(barChartIcon, 'Toggle reading stats', toggleStats);
  statsButton.classList.add('stats-toggle-active');
  setStatsToggleButton(statsButton);

  const themeButton = createThemeButton(vscode, startTheme);
  const { pdfButton, htmlButton } = createExportButtons(vscode);
  const presentationButton = createButton(presentationIcon, 'Presentation mode', enterPresentation);
  const aboutButton = createAboutButton(toolbar);

  toolbar.appendChild(tocButton);
  toolbar.appendChild(statsButton);
  toolbar.appendChild(createSeparator());
  toolbar.appendChild(themeButton);
  // A separator leads the export group so the two export actions read as a unit.
  toolbar.appendChild(createSeparator());
  toolbar.appendChild(pdfButton);
  toolbar.appendChild(htmlButton);
  toolbar.appendChild(presentationButton);
  toolbar.appendChild(aboutButton);

  document.body.appendChild(toolbar);
}
