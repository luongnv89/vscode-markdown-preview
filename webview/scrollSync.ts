// Throttle for preview -> editor scroll reporting: bursts of scroll events are
// coalesced into a single revealLine message to the host.
export const SCROLL_REPORT_THROTTLE = 50;

// Guard window after a programmatic scroll during which the scroll listener
// stays muted, so the echo is not reported back as a user scroll.
export const PROGRAMMATIC_SCROLL_LOCK = 300;

let isScrollingProgrammatically = false;
let scrollLockTimeout: number | undefined;
let scrollThrottleTimeout: number | undefined;

// The .code-line[data-line] elements of the last applied render, cached on
// each content update (issue #77) so a throttled scroll event never
// re-queries the document.
let lineElements: HTMLElement[] = [];
let lineElementSet = new Set<HTMLElement>();

// Code-line elements currently inside the top band of the viewport,
// maintained by an IntersectionObserver — the same pattern the TOC and the
// block highlighter already use — so a scroll report only measures the
// handful of candidates near the top edge instead of reading a layout rect
// for every element in the document.
const visibleLines = new Set<HTMLElement>();
let lineObserver: IntersectionObserver | null = null;

function ensureLineObserver(): IntersectionObserver | null {
  if (lineObserver || typeof IntersectionObserver === 'undefined') {
    return lineObserver;
  }
  lineObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visibleLines.add(entry.target as HTMLElement);
        } else {
          visibleLines.delete(entry.target as HTMLElement);
        }
      }
    },
    // The top ~10% of the viewport: the element straddling the top edge —
    // the one getLineAtScrollPosition reports — always intersects it.
    { rootMargin: '0px 0px -90% 0px', threshold: 0 }
  );
  return lineObserver;
}

// Called from the renderer after each content patch: re-scan the code-line
// elements once per update (the issue's "cache the node list on update"),
// and reconcile observer registrations with what was added or removed.
export function refreshScrollAnchors(container?: HTMLElement | null): void {
  const root: ParentNode = container ?? document;
  const next = Array.from(root.querySelectorAll<HTMLElement>('.code-line[data-line]'));
  const nextSet = new Set(next);

  const observer = ensureLineObserver();
  if (observer) {
    for (const el of lineElements) {
      if (!nextSet.has(el)) {
        observer.unobserve(el);
      }
    }
    for (const el of next) {
      if (!lineElementSet.has(el)) {
        observer.observe(el);
      }
    }
  }
  for (const el of visibleLines) {
    if (!nextSet.has(el)) {
      visibleLines.delete(el);
    }
  }
  lineElements = next;
  lineElementSet = nextSet;
}

// The cached list, lazily populated for callers that scroll before the
// first refresh (and for environments where refreshScrollAnchors never ran).
function getLineElements(): HTMLElement[] {
  if (lineElements.length === 0) {
    lineElements = Array.from(document.querySelectorAll<HTMLElement>('.code-line[data-line]'));
    lineElementSet = new Set(lineElements);
  }
  return lineElements;
}

export function initScrollSync(vscode: VsCodeApi): void {
  ensureLineObserver();
  refreshScrollAnchors();

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
    }, SCROLL_REPORT_THROTTLE);
  });
}

export function scrollToLine(line: number): void {
  isScrollingProgrammatically = true;

  if (scrollLockTimeout) {
    clearTimeout(scrollLockTimeout);
  }

  const elements = getLineElements();
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
        window.scrollY + previousRect.top + progress * (nextRect.top - previousRect.top);
    } else {
      scrollTarget = window.scrollY + previous.element.getBoundingClientRect().top;
    }

    window.scrollTo({ top: Math.max(0, scrollTarget - 20), behavior: 'auto' });
  }

  scrollLockTimeout = window.setTimeout(() => {
    isScrollingProgrammatically = false;
  }, PROGRAMMATIC_SCROLL_LOCK);
}

// The last code-line element at or above the top edge, with its rect.
// Prefers the observer-maintained candidates: the element straddling the
// top edge intersects the band, so only band members pay for a rect read.
// When the observer has nothing to offer (unsupported, or a stretch of
// viewport without code-line elements) fall back to the full scan.
function findTopElement(elements: HTMLElement[]): { index: number; rect: DOMRect } | null {
  if (visibleLines.size > 0) {
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (visibleLines.has(el)) {
        const r = el.getBoundingClientRect();
        if (r.top <= 10) {
          return { index: i, rect: r };
        }
      }
    }
  }
  for (let i = elements.length - 1; i >= 0; i--) {
    const r = elements[i].getBoundingClientRect();
    if (r.top <= 10) {
      return { index: i, rect: r };
    }
  }
  return null;
}

function getLineAtScrollPosition(): number {
  const elements = getLineElements();
  const found = findTopElement(elements);
  if (!found) {
    return 0;
  }

  const line = parseInt(elements[found.index].getAttribute('data-line') || '0', 10);
  const nextElement = elements[found.index + 1];

  if (nextElement) {
    const nextRect = nextElement.getBoundingClientRect();
    if (nextRect.top > found.rect.top) {
      const progress = -found.rect.top / (nextRect.top - found.rect.top);
      const nextLine = parseInt(nextElement.getAttribute('data-line') || '0', 10);
      return line + Math.max(0, progress) * (nextLine - line);
    }
  }
  return line;
}
