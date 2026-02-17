let isScrollingProgrammatically = false;
let scrollLockTimeout: number | undefined;
let scrollThrottleTimeout: number | undefined;

export function initScrollSync(vscode: VsCodeApi): void {
  // Throttled scroll listener for preview -> editor sync
  document.addEventListener('scroll', () => {
    if (isScrollingProgrammatically) {
      return;
    }

    if (scrollThrottleTimeout) {
      clearTimeout(scrollThrottleTimeout);
    }

    scrollThrottleTimeout = window.setTimeout(() => {
      const line = getLineAtScrollPosition();
      if (line >= 0) {
        vscode.postMessage({
          type: 'revealLine',
          line: Math.floor(line),
          source: 'preview',
        });
      }
    }, 50);
  });
}

export function scrollToLine(line: number): void {
  isScrollingProgrammatically = true;

  if (scrollLockTimeout) {
    clearTimeout(scrollLockTimeout);
  }

  const elements = document.querySelectorAll('.code-line[data-line]');
  let previous: { element: Element; line: number } | null = null;
  let next: { element: Element; line: number } | null = null;

  for (const element of elements) {
    const elementLine = parseInt(element.getAttribute('data-line') || '0', 10);
    if (elementLine <= line) {
      previous = { element, line: elementLine };
    }
    if (elementLine > line && !next) {
      next = { element, line: elementLine };
      break;
    }
  }

  if (previous) {
    let scrollTarget: number;

    if (next && next.line !== previous.line) {
      // Interpolate between elements
      const progress = (line - previous.line) / (next.line - previous.line);
      const previousRect = previous.element.getBoundingClientRect();
      const nextRect = next.element.getBoundingClientRect();
      scrollTarget =
        window.scrollY +
        previousRect.top +
        progress * (nextRect.top - previousRect.top);
    } else {
      scrollTarget = window.scrollY + previous.element.getBoundingClientRect().top;
    }

    window.scrollTo({ top: Math.max(0, scrollTarget - 20), behavior: 'auto' });
  }

  scrollLockTimeout = window.setTimeout(() => {
    isScrollingProgrammatically = false;
  }, 300);
}

function getLineAtScrollPosition(): number {
  const elements = Array.from(
    document.querySelectorAll('.code-line[data-line]')
  );

  for (let i = elements.length - 1; i >= 0; i--) {
    const rect = elements[i].getBoundingClientRect();
    if (rect.top <= 10) {
      const line = parseInt(elements[i].getAttribute('data-line') || '0', 10);
      const nextElement = elements[i + 1];

      if (nextElement) {
        const nextRect = nextElement.getBoundingClientRect();
        if (nextRect.top > rect.top) {
          const progress = -rect.top / (nextRect.top - rect.top);
          const nextLine = parseInt(
            nextElement.getAttribute('data-line') || '0',
            10
          );
          return line + Math.max(0, progress) * (nextLine - line);
        }
      }
      return line;
    }
  }
  return 0;
}
