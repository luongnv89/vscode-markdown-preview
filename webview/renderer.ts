import { addCopyButtons } from './copyButton';
import { isDarkTheme } from './theme';
import { refreshBlockHighlighter } from './blockHighlighter';
import { refreshToc } from './toc';
import { refreshStats } from './statsBar';
import type { PreviewConfig } from './types/messages';

let mermaidInitialized = false;
let updateInProgress = false;
let pendingUpdate: string | null = null;
let themeObserver: MutationObserver | null = null;

// Feature flags last pushed by the host via configChanged. They default to on
// so content rendered before the first config push behaves exactly as before;
// the host already gates block emission, this is the webview-side half.
let currentConfig: Pick<PreviewConfig, 'enableMermaid' | 'enableExcalidraw'> = {
  enableMermaid: true,
  enableExcalidraw: true,
};
// The last HTML applied — retained so a configChanged can re-render under the
// new flags without waiting for the host's own re-render.
let lastHtml: string | null = null;

/**
 * Apply a config pushed by the host's configChanged message. Stores the flags
 * the renderers consult and re-renders the current content when a diagram flag
 * toggled, so already-emitted blocks are processed or dropped immediately.
 */
export function applyConfig(config: PreviewConfig): void {
  const diagramFlagToggled =
    config.enableMermaid !== currentConfig.enableMermaid ||
    config.enableExcalidraw !== currentConfig.enableExcalidraw;
  currentConfig = config;
  if (diagramFlagToggled && lastHtml !== null) {
    void updateContent(lastHtml);
  }
}

export async function updateContent(html: string): Promise<void> {
  // If an update is already in progress, queue the latest one
  if (updateInProgress) {
    pendingUpdate = html;
    return;
  }

  updateInProgress = true;
  lastHtml = html;

  try {
    const container = document.getElementById('preview-content');
    if (!container) {
      return;
    }

    // Save scroll position
    const scrollTop = window.scrollY;

    container.innerHTML = html;

    // Post-process: add features
    addCopyButtons();

    // Render mermaid diagrams (skipped entirely when the feature is off)
    if (currentConfig.enableMermaid) {
      await renderMermaid();
    }

    // Render excalidraw diagrams (skipped entirely when the feature is off)
    if (currentConfig.enableExcalidraw) {
      await renderExcalidraw();
    }

    // Render KaTeX math
    renderKatex();

    // Refresh block highlighter
    refreshBlockHighlighter();

    // Refresh TOC and stats
    refreshToc();
    refreshStats();

    // Restore scroll position
    window.scrollTo(0, scrollTop);
  } finally {
    updateInProgress = false;

    // Process queued update if any
    if (pendingUpdate !== null) {
      const next = pendingUpdate;
      pendingUpdate = null;
      await updateContent(next);
    }
  }
}

async function renderMermaid(): Promise<void> {
  const mermaidBlocks = document.querySelectorAll('.mermaid-block[data-processed="false"]');
  if (mermaidBlocks.length === 0) {
    return;
  }

  // Access mermaid from global scope (loaded via script tag)
  const mermaid = window.mermaid;
  if (!mermaid) {
    console.warn('Mermaid library not available on window');
    return;
  }

  if (!mermaidInitialized) {
    const isDark = isDarkTheme();

    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      // 'strict': labels are sanitized and `click` JS directives are never
      // bound — diagram text comes straight from the untrusted document.
      securityLevel: 'strict',
      // Mermaid 12 changed its defaults to the ELK layout engine and the
      // `neo` look — pin dagre + classic to keep the pre-v12 rendering.
      layout: 'dagre',
      look: 'classic',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    });

    mermaidInitialized = true;
  }

  for (let i = 0; i < mermaidBlocks.length; i++) {
    const block = mermaidBlocks[i];
    const pre = block.querySelector('pre.mermaid');
    const code = pre ? pre.textContent || '' : (block as HTMLElement).dataset.source || '';
    if (!code) {
      continue;
    }
    const id = `mermaid-${Date.now()}-${i}`;

    try {
      const { svg } = await mermaid.render(id, code);
      block.innerHTML = svg;
      block.setAttribute('data-processed', 'true');
      (block as HTMLElement).classList.add('mermaid-rendered');
    } catch (err) {
      // textContent, not innerHTML+escape: the error message is untrusted
      // text, so the DOM escapes it natively (issue #55 — this replaced the
      // webview-local escapeHtml, which escaped a narrower character set).
      const errorDiv = document.createElement('div');
      errorDiv.className = 'mermaid-error';
      errorDiv.textContent = `Mermaid diagram error: ${(err as Error).message}`;
      block.replaceChildren(errorDiv);
      block.setAttribute('data-processed', 'true');
    }
  }
}

async function renderExcalidraw(): Promise<void> {
  const blocks = document.querySelectorAll('.excalidraw-block[data-processed="false"]');
  if (blocks.length === 0) {
    return;
  }

  const ExcalidrawUtils = window.ExcalidrawUtils;
  if (!ExcalidrawUtils || !ExcalidrawUtils.exportToSvg) {
    console.warn('ExcalidrawUtils library not available on window');
    return;
  }

  const isDark = isDarkTheme();

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const pre = block.querySelector('pre.excalidraw-source');
    const jsonStr = pre ? pre.textContent || '' : (block as HTMLElement).dataset.source || '';
    if (!jsonStr) {
      continue;
    }

    try {
      const data = JSON.parse(jsonStr);

      if (!data.elements || !Array.isArray(data.elements)) {
        throw new Error('Invalid Excalidraw data: missing elements array');
      }

      const svg = await ExcalidrawUtils.exportToSvg({
        data: {
          elements: data.elements,
          appState: {
            ...data.appState,
            exportWithDarkMode: isDark,
            viewBackgroundColor: isDark ? '#1e1e1e' : '#ffffff',
          },
          files: data.files || null,
        },
      });

      block.innerHTML = '';
      block.appendChild(svg);
      block.setAttribute('data-processed', 'true');
      (block as HTMLElement).classList.add('excalidraw-rendered');
    } catch (err) {
      // Same textContent-not-innerHTML reasoning as the mermaid-error path.
      const errorDiv = document.createElement('div');
      errorDiv.className = 'excalidraw-error';
      errorDiv.textContent = `Excalidraw diagram error: ${(err as Error).message}`;
      block.replaceChildren(errorDiv);
      block.setAttribute('data-processed', 'true');
    }
  }
}

function renderKatex(): void {
  const katex = window.katex;
  if (!katex) {
    return;
  }

  // Render inline math
  const inlineMath = document.querySelectorAll('.katex-inline[data-math]');
  inlineMath.forEach((el) => {
    const math = el.getAttribute('data-math');
    if (!math) {
      return;
    }
    try {
      katex.render(math, el as HTMLElement, { throwOnError: false, displayMode: false });
    } catch {
      // Leave the raw text as fallback
    }
  });

  // Render block math
  const blockMath = document.querySelectorAll('.katex-block[data-math]');
  blockMath.forEach((el) => {
    const math = el.getAttribute('data-math');
    if (!math) {
      return;
    }
    try {
      katex.render(math, el as HTMLElement, { throwOnError: false, displayMode: true });
    } catch {
      // Leave the raw text as fallback
    }
  });
}

// Watch for theme changes to reinitialize mermaid and excalidraw
export function watchThemeChanges(): void {
  if (themeObserver) {
    themeObserver.disconnect();
  }

  let themeChangeTimer: ReturnType<typeof setTimeout> | null = null;

  themeObserver = new MutationObserver(() => {
    // Debounce: the toolbar does remove+add in two mutations; wait for both to settle
    if (themeChangeTimer) {
      clearTimeout(themeChangeTimer);
    }
    themeChangeTimer = setTimeout(() => {
      themeChangeTimer = null;
      mermaidInitialized = false;

      // Re-render mermaid diagrams
      if (currentConfig.enableMermaid) {
        const mermaidBlocks = document.querySelectorAll('.mermaid-block');
        mermaidBlocks.forEach((block) => {
          block.setAttribute('data-processed', 'false');
        });
        renderMermaid();
      }

      // Re-render excalidraw diagrams
      if (currentConfig.enableExcalidraw) {
        const excalidrawBlocks = document.querySelectorAll('.excalidraw-block');
        excalidrawBlocks.forEach((block) => {
          block.setAttribute('data-processed', 'false');
        });
        renderExcalidraw();
      }
    }, 50);
  });

  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
}
