let currentBlock: HTMLElement | null = null;
let observer: IntersectionObserver | null = null;
const observed = new Set<Element>();

// The top-level blocks the active-block highlight tracks — the same set the
// original 14-selector '#preview-content > …' query covered, minus the scope
// prefix (matching runs on nodes already known to be top-level children).
const BLOCK_SELECTOR =
  'h1, h2, h3, h4, h5, h6, p, pre, .hljs, blockquote, ul, ol, table, ' +
  '.mermaid-block, .katex-block, .code-block-wrapper';

export function initBlockHighlighter(): void {
  ensureObserver();
  const container = document.getElementById('preview-content');
  if (!observer || !container) {
    return;
  }
  for (const el of Array.from(container.children)) {
    if (el.matches(BLOCK_SELECTOR)) {
      observer.observe(el);
      observed.add(el);
    }
  }
}

// Incremental refresh (issue #77): unobserve only the nodes the patch
// removed and observe only the top-level nodes it inserted — the observer
// and its registrations over kept blocks survive the update.
export function refreshBlockHighlighter(removed: Element[], added: Element[]): void {
  ensureObserver();
  if (!observer) {
    return;
  }
  for (const el of removed) {
    if (observed.delete(el)) {
      observer.unobserve(el);
    }
    if (currentBlock === el) {
      currentBlock = null;
    }
  }
  for (const el of added) {
    if (el.matches(BLOCK_SELECTOR) && !observed.has(el)) {
      observer.observe(el);
      observed.add(el);
    }
  }
}

function ensureObserver(): void {
  if (observer || typeof IntersectionObserver === 'undefined') {
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      // Find the topmost visible element
      let topEntry: IntersectionObserverEntry | null = null;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          if (!topEntry || entry.boundingClientRect.top < topEntry.boundingClientRect.top) {
            topEntry = entry;
          }
        }
      }

      if (topEntry) {
        setActiveBlock(topEntry.target as HTMLElement);
      }
    },
    {
      rootMargin: '-10% 0px -80% 0px',
      threshold: 0,
    }
  );
}

function setActiveBlock(block: HTMLElement): void {
  if (currentBlock === block) {
    return;
  }

  if (currentBlock) {
    currentBlock.classList.remove('active-block');
  }

  block.classList.add('active-block');
  currentBlock = block;
}
