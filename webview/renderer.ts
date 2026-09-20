import { addCopyButtons } from './copyButton';
import { isDarkTheme } from './theme';
import { refreshBlockHighlighter } from './blockHighlighter';
import { refreshToc } from './toc';
import { refreshStats } from './statsBar';
import { refreshScrollAnchors } from './scrollSync';
import { applyBlockPatch, topLevelNodes, BlockPatch } from './domDiff';
import type { PreviewConfig } from './types/messages';

// Debounce for the theme observer: the toolbar's class swap arrives as two
// mutations, so the diagram re-render waits for both to settle.
export const THEME_CHANGE_DEBOUNCE = 50;

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
// Set by applyConfig: a feature-flag toggle re-renders the same source under
// new rules, so the next applied render bypasses the incremental patch and
// rebuilds wholesale — the same behavior the pre-#77 innerHTML path had.
let pendingFullRebuild = false;

// ---- Diagram render cache (issue #75) ----
// Incoming HTML re-flags each diagram block as data-processed="false", and
// before #77 a full innerHTML rebuild re-created every block on each update.
// The incremental patch now keeps unchanged blocks outright, so the cache
// covers the remaining cases: a block whose source was edited back to a
// previously seen value, and first-time inserts. Entries are keyed
// by a hash of the diagram source — never by block index, which shifts as the
// document is edited — and the stored source is compared on lookup so a hash
// collision can never inject the wrong SVG. The whole cache clears on theme
// change, since dark/light changes what the same source renders to.
interface DiagramCacheEntry {
  source: string;
  kind: 'svg' | 'error';
  content: string;
}
const diagramCache = new Map<string, DiagramCacheEntry>();
const DIAGRAM_CACHE_LIMIT = 64;

// cyrb53 — a small 53-bit string hash — derives stable mermaid render ids and
// cache keys from diagram source (replacing the per-render timestamp ids that
// defeated any caching and orphaned Mermaid's per-id <style> blocks).
function hashSource(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

function cacheStore(key: string, entry: DiagramCacheEntry): void {
  if (diagramCache.size >= DIAGRAM_CACHE_LIMIT) {
    // FIFO eviction — Map iterates in insertion order, so the first key is
    // the oldest entry. Editing churn creates one entry per source variant;
    // the cap keeps a long session from growing it without bound.
    const oldest = diagramCache.keys().next();
    if (!oldest.done) {
      diagramCache.delete(oldest.value);
    }
  }
  diagramCache.set(key, entry);
}

// On a verified cache hit (same engine, same source) re-inject the recorded
// output instead of re-rendering: SVG markup is innerHTML'd back, an error is
// rebuilt through buildDiagramError so the lead still names this block's
// current data-line. Returns true when the block was restored.
function restoreCachedDiagram(
  block: Element,
  key: string,
  source: string,
  engine: 'mermaid' | 'excalidraw'
): boolean {
  const entry = diagramCache.get(key);
  if (!entry || entry.source !== source) {
    return false;
  }
  if (entry.kind === 'svg') {
    block.innerHTML = entry.content;
    (block as HTMLElement).classList.add(`${engine}-rendered`);
  } else {
    block.replaceChildren(buildDiagramError(block, engine, entry.content));
  }
  block.setAttribute('data-processed', 'true');
  return true;
}

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
    pendingFullRebuild = true;
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

  try {
    // Drain the queue in a loop rather than recursing out of finally — a
    // sustained typing stream queues continuously and recursion would stack
    // an await chain per keystroke (issue #75).
    let current: string | null = html;
    while (current !== null) {
      lastHtml = current;

      const container = document.getElementById('preview-content');
      if (container) {
        // Save scroll position
        const scrollTop = window.scrollY;

        // Patch the DOM instead of rebuilding it (issue #77): only the
        // blocks whose rendered source changed are replaced — kept blocks
        // retain their nodes, observers, and rendered output. An identical
        // render short-circuits post-processing entirely.
        const patch = applyBlockPatch(container, current, pendingFullRebuild);
        pendingFullRebuild = false;
        if (patch.changed) {
          await postProcessRenderedContent(container, patch);
        }

        // Restore scroll position
        window.scrollTo(0, scrollTop);
      }

      current = pendingUpdate;
      pendingUpdate = null;
    }
  } finally {
    updateInProgress = false;
  }
}

// Post-process the freshly patched DOM: copy buttons first (wrapping a
// <pre> changes which top-level node the highlighter observes), then each
// diagram / math engine gated on its feature flag, then the chrome
// refreshes. Diagram renderers still query document-wide — the
// data-processed="false" flag on inserted blocks scopes them naturally —
// while everything else works on the patch's added/removed lists only.
async function postProcessRenderedContent(
  container: HTMLElement,
  patch: BlockPatch
): Promise<void> {
  addCopyButtons(patch.added);

  // Render mermaid diagrams (skipped entirely when the feature is off)
  if (currentConfig.enableMermaid) {
    await renderMermaid();
  }

  // Render excalidraw diagrams (skipped entirely when the feature is off)
  if (currentConfig.enableExcalidraw) {
    await renderExcalidraw();
  }

  // Render KaTeX math inside the inserted subtrees only — kept blocks
  // already hold their rendered output.
  renderKatex(patch.added);

  // Refresh block highlighter over the changed top-level nodes
  refreshBlockHighlighter(patch.removed, topLevelNodes(container, patch.added));

  // Refresh TOC and stats — each skips internally when its inputs are
  // unchanged — and re-cache the code-line elements for scroll sync.
  refreshToc();
  refreshStats();
  refreshScrollAnchors(container);
}

// One-time mermaid.initialize with the pinned pre-v12 look — re-runs after a
// theme change flips mermaidInitialized back to false.
function ensureMermaidInitialized(mermaid: NonNullable<typeof window.mermaid>): void {
  if (mermaidInitialized) {
    return;
  }
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

// Build a readable diagram error (issue #68): lead with the block type and
// the document line the fence starts on — data-line is the 0-based source
// map, so +1 names the editor line — and keep the raw parser output inside a
// collapsed <details>. Everything is textContent-built: the parser message is
// untrusted text and must never reach innerHTML (issue #55).
function buildDiagramError(block: Element, engine: string, err: unknown): HTMLElement {
  const errorDiv = document.createElement('div');
  errorDiv.className = `${engine}-error`;

  const lead = document.createElement('div');
  lead.className = `${engine}-error-lead`;
  const lineAttr = (block as HTMLElement).dataset.line;
  const docLine = lineAttr ? Number(lineAttr) + 1 : NaN;
  lead.textContent = Number.isFinite(docLine)
    ? `The \`${engine}\` diagram at document line ${docLine} could not be rendered.`
    : `This \`${engine}\` diagram could not be rendered.`;

  const details = document.createElement('details');
  details.className = `${engine}-error-details`;
  const summary = document.createElement('summary');
  summary.textContent = 'Diagram error details';
  const raw = document.createElement('pre');
  raw.className = `${engine}-error-raw`;
  raw.textContent = err instanceof Error ? err.message : String(err);
  details.appendChild(summary);
  details.appendChild(raw);

  errorDiv.appendChild(lead);
  errorDiv.appendChild(details);
  return errorDiv;
}

// Render one .mermaid-block: swap its <pre> for the rendered SVG, or show a
// readable error div (buildDiagramError keeps the raw parser output behind a
// <details> and names the document line). Output is cached on the source
// hash — an unchanged diagram skips mermaid.render entirely (issue #75).
async function renderMermaidBlock(
  mermaid: NonNullable<typeof window.mermaid>,
  block: Element
): Promise<void> {
  const pre = block.querySelector('pre.mermaid');
  const code = pre ? pre.textContent || '' : (block as HTMLElement).dataset.source || '';
  if (!code) {
    return;
  }
  const hash = hashSource(code);
  if (restoreCachedDiagram(block, `mermaid:${hash}`, code, 'mermaid')) {
    return;
  }

  try {
    // The render id is derived from the source hash: identical sources reuse
    // the id (and its styles) instead of orphaning a fresh set each update.
    const { svg } = await mermaid.render(`mermaid-${hash}`, code);
    block.innerHTML = svg;
    block.setAttribute('data-processed', 'true');
    (block as HTMLElement).classList.add('mermaid-rendered');
    cacheStore(`mermaid:${hash}`, { source: code, kind: 'svg', content: svg });
  } catch (err) {
    block.replaceChildren(buildDiagramError(block, 'mermaid', err));
    block.setAttribute('data-processed', 'true');
    // Cache failures too — the same source would fail the same way on every
    // keystroke, and the error div is rebuilt with the block's own data-line.
    cacheStore(`mermaid:${hash}`, {
      source: code,
      kind: 'error',
      content: err instanceof Error ? err.message : String(err),
    });
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

  ensureMermaidInitialized(mermaid);

  for (let i = 0; i < mermaidBlocks.length; i++) {
    await renderMermaidBlock(mermaid, mermaidBlocks[i]);
  }
}

// Parse + export one excalidraw source string to its SVG element; throws on
// malformed JSON or a missing elements array.
async function exportExcalidrawSvg(
  ExcalidrawUtils: NonNullable<typeof window.ExcalidrawUtils>,
  jsonStr: string,
  isDark: boolean
): Promise<SVGSVGElement> {
  const data = JSON.parse(jsonStr);

  if (!data.elements || !Array.isArray(data.elements)) {
    throw new Error('Invalid Excalidraw data: missing elements array');
  }

  return ExcalidrawUtils.exportToSvg({
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
}

// Render one .excalidraw-block: parse its source JSON, export to SVG, or show
// the same readable error div the mermaid path uses (buildDiagramError).
// Output is cached on the source hash, like the mermaid path (issue #75).
async function renderExcalidrawBlock(
  ExcalidrawUtils: NonNullable<typeof window.ExcalidrawUtils>,
  block: Element,
  isDark: boolean
): Promise<void> {
  const pre = block.querySelector('pre.excalidraw-source');
  const jsonStr = pre ? pre.textContent || '' : (block as HTMLElement).dataset.source || '';
  if (!jsonStr) {
    return;
  }
  const hash = hashSource(jsonStr);
  if (restoreCachedDiagram(block, `excalidraw:${hash}`, jsonStr, 'excalidraw')) {
    return;
  }

  try {
    const svg = await exportExcalidrawSvg(ExcalidrawUtils, jsonStr, isDark);
    block.innerHTML = '';
    block.appendChild(svg);
    block.setAttribute('data-processed', 'true');
    (block as HTMLElement).classList.add('excalidraw-rendered');
    cacheStore(`excalidraw:${hash}`, { source: jsonStr, kind: 'svg', content: svg.outerHTML });
  } catch (err) {
    block.replaceChildren(buildDiagramError(block, 'excalidraw', err));
    block.setAttribute('data-processed', 'true');
    cacheStore(`excalidraw:${hash}`, {
      source: jsonStr,
      kind: 'error',
      content: err instanceof Error ? err.message : String(err),
    });
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
    await renderExcalidrawBlock(ExcalidrawUtils, blocks[i], isDark);
  }
}

// Invoke `cb` on every element matching `selector` inside the inserted
// roots — including a root itself when it matches (a top-level .katex-block).
function forEachInRoots(roots: Element[], selector: string, cb: (el: Element) => void): void {
  for (const root of roots) {
    if (root.matches(selector)) {
      cb(root);
    }
    root.querySelectorAll(selector).forEach(cb);
  }
}

function renderKatex(roots: Element[]): void {
  const katex = window.katex;
  if (!katex || roots.length === 0) {
    return;
  }

  // Render inline math
  forEachInRoots(roots, '.katex-inline[data-math]', (el) => {
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
  forEachInRoots(roots, '.katex-block[data-math]', (el) => {
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
      // Dark/light changes what every diagram renders to — cached output is
      // only valid under the theme that produced it.
      diagramCache.clear();

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
    }, THEME_CHANGE_DEBOUNCE);
  });

  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
}
