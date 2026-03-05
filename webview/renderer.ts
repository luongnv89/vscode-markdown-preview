import { refreshCopyButtons } from './copyButton';
import { refreshBlockHighlighter } from './blockHighlighter';
import { refreshToc } from './toc';
import { refreshStats } from './statsBar';

let mermaidInitialized = false;
let updateInProgress = false;
let pendingUpdate: string | null = null;
let themeObserver: MutationObserver | null = null;

export async function updateContent(html: string): Promise<void> {
  // If an update is already in progress, queue the latest one
  if (updateInProgress) {
    pendingUpdate = html;
    return;
  }

  updateInProgress = true;

  try {
    const container = document.getElementById('preview-content');
    if (!container) {
      return;
    }

    // Save scroll position
    const scrollTop = window.scrollY;

    container.innerHTML = html;

    // Post-process: add features
    refreshCopyButtons();

    // Render mermaid diagrams
    await renderMermaid();

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
  const mermaid = (window as any).mermaid;
  if (!mermaid) {
    console.warn('Mermaid library not available on window');
    return;
  }

  if (!mermaidInitialized) {
    const isDark =
      document.body.classList.contains('preview-theme-dark') ||
      (!document.body.classList.contains('preview-theme-light') &&
        (document.body.classList.contains('vscode-dark') ||
          document.body.classList.contains('vscode-high-contrast')));

    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'loose',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    });

    mermaidInitialized = true;
  }

  for (let i = 0; i < mermaidBlocks.length; i++) {
    const block = mermaidBlocks[i];
    const pre = block.querySelector('pre.mermaid');
    if (!pre) {
      continue;
    }

    const code = pre.textContent || '';
    const id = `mermaid-${Date.now()}-${i}`;

    try {
      const { svg } = await mermaid.render(id, code);
      block.innerHTML = svg;
      block.setAttribute('data-processed', 'true');
      (block as HTMLElement).classList.add('mermaid-rendered');
    } catch (err) {
      block.innerHTML = `<div class="mermaid-error">Mermaid diagram error: ${escapeHtml((err as Error).message)}</div>`;
      block.setAttribute('data-processed', 'true');
    }
  }
}

function renderKatex(): void {
  const katex = (window as any).katex;
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
      katex.render(math, el, { throwOnError: false, displayMode: false });
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
      katex.render(math, el, { throwOnError: false, displayMode: true });
    } catch {
      // Leave the raw text as fallback
    }
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Watch for theme changes to reinitialize mermaid
export function watchThemeChanges(): void {
  if (themeObserver) {
    themeObserver.disconnect();
  }

  themeObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        // Theme changed, reinitialize mermaid
        mermaidInitialized = false;

        // Re-render mermaid diagrams
        const mermaidBlocks = document.querySelectorAll('.mermaid-block');
        mermaidBlocks.forEach((block) => {
          block.setAttribute('data-processed', 'false');
        });
        renderMermaid();
      }
    }
  });

  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
}
