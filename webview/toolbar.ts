import { toggleToc, setTocToggleButton } from './toc';
import { toggleStats, setStatsToggleButton } from './statsBar';
import { enterPresentation } from './presentation';
import { isDarkTheme } from './theme';
import { createButton, createSeparator } from './domUtils';
import { createAboutButton } from './aboutPopup';
import { sunIcon, moonIcon, pdfIcon, htmlIcon, listIcon, barChartIcon, playIcon } from './icons';

function createThemeButton(initialTheme: 'light' | 'dark'): HTMLButtonElement {
  let currentTheme = initialTheme;
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
  return themeButton;
}

export function initToolbar(vscode: VsCodeApi): void {
  const toolbar = document.createElement('div');
  toolbar.className = 'preview-toolbar';

  const currentTheme = isDarkTheme() ? 'dark' : 'light';

  // Apply initial theme based on VS Code theme
  document.body.classList.add(
    currentTheme === 'dark' ? 'preview-theme-dark' : 'preview-theme-light'
  );

  const themeButton = createThemeButton(currentTheme);
  const pdfButton = createButton(pdfIcon, 'Export to PDF', () => {
    vscode.postMessage({ type: 'exportToPdf' });
  });
  const htmlButton = createButton(htmlIcon, 'Export to HTML', () => {
    vscode.postMessage({ type: 'exportToHtml' });
  });
  const aboutButton = createAboutButton(toolbar);

  // TOC toggle button
  const tocButton = createButton(listIcon, 'Toggle Table of Contents', toggleToc);
  setTocToggleButton(tocButton);

  // Stats toggle button
  const statsButton = createButton(barChartIcon, 'Toggle reading stats', toggleStats);
  statsButton.classList.add('stats-toggle-active');
  setStatsToggleButton(statsButton);

  // Presentation button
  const presentationButton = createButton(playIcon, 'Presentation mode', enterPresentation);

  toolbar.appendChild(tocButton);
  toolbar.appendChild(statsButton);
  toolbar.appendChild(createSeparator());
  toolbar.appendChild(themeButton);
  toolbar.appendChild(pdfButton);
  toolbar.appendChild(htmlButton);
  toolbar.appendChild(presentationButton);
  toolbar.appendChild(aboutButton);

  document.body.appendChild(toolbar);
}
