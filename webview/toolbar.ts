import { toggleToc, setTocToggleButton } from './toc';
import { toggleStats, setStatsToggleButton } from './statsBar';
import { enterPresentation } from './presentation';
import { isDarkTheme } from './theme';
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

function applyTheme(theme: PreviewTheme): void {
  document.body.classList.toggle('preview-theme-dark', theme === 'dark');
  document.body.classList.toggle('preview-theme-light', theme === 'light');
}

// The manual toggle's choice survives panel reloads via vscode.setState —
// merged so the scroll position main.ts persists is never clobbered.
function persistTheme(vscode: VsCodeApi, theme: PreviewTheme): void {
  vscode.setState({ ...vscode.getState(), theme });
}

// A persisted manual choice wins; otherwise follow the VS Code theme.
function initialTheme(vscode: VsCodeApi): PreviewTheme {
  const persisted = vscode.getState()?.theme;
  if (persisted === 'dark' || persisted === 'light') {
    return persisted;
  }
  return isDarkTheme() ? 'dark' : 'light';
}

function createThemeButton(vscode: VsCodeApi, initial: PreviewTheme): HTMLButtonElement {
  let currentTheme = initial;
  const themeButton = createButton(
    currentTheme === 'dark' ? sunIcon : moonIcon,
    currentTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
    () => {
      currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
      applyTheme(currentTheme);
      persistTheme(vscode, currentTheme);
      themeButton.innerHTML = currentTheme === 'dark' ? sunIcon : moonIcon;
      const label = currentTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
      themeButton.title = label;
      themeButton.setAttribute('aria-label', label);
      // Keep the CSS hover/focus tooltip (attr(data-label)) in sync — it would
      // otherwise keep announcing the pre-toggle action.
      themeButton.dataset.label = label;
      themeButton.setAttribute('aria-pressed', String(currentTheme === 'dark'));
    }
  );
  themeButton.setAttribute('aria-pressed', String(currentTheme === 'dark'));
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

  const startTheme = initialTheme(vscode);
  applyTheme(startTheme);

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
