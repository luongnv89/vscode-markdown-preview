let currentBlock: HTMLElement | null = null;
let observer: IntersectionObserver | null = null;

export function initBlockHighlighter(): void {
  setupObserver();
}

export function refreshBlockHighlighter(): void {
  if (observer) {
    observer.disconnect();
  }
  setupObserver();
}

function setupObserver(): void {
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

  const blocks = document.querySelectorAll(
    '#preview-content > h1, #preview-content > h2, #preview-content > h3, ' +
      '#preview-content > h4, #preview-content > h5, #preview-content > h6, ' +
      '#preview-content > p, #preview-content > pre, #preview-content > .hljs, ' +
      '#preview-content > blockquote, #preview-content > ul, #preview-content > ol, ' +
      '#preview-content > table, #preview-content > .mermaid-block, ' +
      '#preview-content > .katex-block, #preview-content > .code-block-wrapper'
  );

  blocks.forEach((block) => observer!.observe(block));
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
