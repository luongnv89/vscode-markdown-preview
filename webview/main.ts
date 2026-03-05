import './styles/main.css';
import './styles/markdown.css';
import './styles/code.css';
import './styles/mermaid.css';
import './styles/highlight.css';
import './styles/toolbar.css';
import './styles/toc.css';
import './styles/statsBar.css';
import './styles/presentation.css';

import { initScrollSync, scrollToLine } from './scrollSync';
import { initBlockHighlighter } from './blockHighlighter';
import { initCopyButtons } from './copyButton';
import { initCheckboxHandler } from './checkboxHandler';
import { initNavigationHandler } from './navigationHandler';
import { updateContent, watchThemeChanges } from './renderer';
import { initToolbar } from './toolbar';
import { initToc } from './toc';
import { initStatsBar } from './statsBar';
import { initPresentation } from './presentation';

const vscode = acquireVsCodeApi();

// Initialize all modules
initScrollSync(vscode);
initBlockHighlighter();
initCopyButtons();
initCheckboxHandler(vscode);
initNavigationHandler(vscode);
initToolbar(vscode);
initToc();
initStatsBar();
initPresentation();
watchThemeChanges();

// Listen for messages from extension
window.addEventListener('message', async (event) => {
  const message = event.data;

  switch (message.type) {
    case 'updateContent':
      await updateContent(message.html);
      break;

    case 'scrollToLine':
      scrollToLine(message.line);
      break;

    case 'configChanged':
      // Config changes are handled by the extension re-rendering
      break;
  }
});

// Restore previous state
const previousState = vscode.getState();
if (previousState?.scrollPosition) {
  window.scrollTo(0, previousState.scrollPosition);
}

// Save scroll position periodically
let saveStateTimeout: number | undefined;
document.addEventListener('scroll', () => {
  if (saveStateTimeout) {
    clearTimeout(saveStateTimeout);
  }
  saveStateTimeout = window.setTimeout(() => {
    vscode.setState({ scrollPosition: window.scrollY });
  }, 200);
});

// Tell extension we're ready
vscode.postMessage({ type: 'ready' });
