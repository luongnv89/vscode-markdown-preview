let sidebar: HTMLElement | null = null;
let tocList: HTMLElement | null = null;
let observer: IntersectionObserver | null = null;
let toggleButton: HTMLButtonElement | null = null;

export function initToc(): void {
  sidebar = document.createElement('nav');
  sidebar.className = 'toc-sidebar';
  sidebar.innerHTML = '<div class="toc-sidebar-title">Contents</div>';

  tocList = document.createElement('ul');
  sidebar.appendChild(tocList);
  document.body.appendChild(sidebar);
}

export function setTocToggleButton(button: HTMLButtonElement): void {
  toggleButton = button;
}

export function toggleToc(): void {
  if (!sidebar) return;
  const isVisible = sidebar.classList.toggle('toc-visible');
  document.body.classList.toggle('toc-open', isVisible);
  toggleButton?.classList.toggle('toc-toggle-active', isVisible);
}

interface TocEntry {
  el: HTMLElement;
  link: HTMLAnchorElement;
}

// One <li><a class="toc-hN"> per heading, appended to tocList; ensures each
// heading has an id so the link target exists.
function buildTocEntries(headings: NodeListOf<HTMLElement>): TocEntry[] {
  const entries: TocEntry[] = [];

  headings.forEach((heading, i) => {
    // Ensure heading has an id for linking
    if (!heading.id) {
      heading.id = `heading-${i}`;
    }

    const level = heading.tagName.toLowerCase(); // h1..h6
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = `toc-${level}`;
    a.textContent = heading.textContent || '';
    a.href = '#';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    li.appendChild(a);
    tocList!.appendChild(li);
    entries.push({ el: heading, link: a });
  });

  return entries;
}

// Highlight active heading using IntersectionObserver: the topmost visible
// entry gets .toc-active, the rest are cleared.
function createTocObserver(entries: TocEntry[]): IntersectionObserver {
  const activeSet = new Set<HTMLElement>();

  return new IntersectionObserver(
    (observerEntries) => {
      for (const entry of observerEntries) {
        if (entry.isIntersecting) {
          activeSet.add(entry.target as HTMLElement);
        } else {
          activeSet.delete(entry.target as HTMLElement);
        }
      }

      // Clear all active
      entries.forEach((e) => e.link.classList.remove('toc-active'));

      // Find topmost visible heading
      for (const e of entries) {
        if (activeSet.has(e.el)) {
          e.link.classList.add('toc-active');
          break;
        }
      }
    },
    { rootMargin: '0px 0px -70% 0px', threshold: 0 }
  );
}

export function refreshToc(): void {
  if (!tocList) return;

  const container = document.getElementById('preview-content');
  if (!container) return;

  const headings = container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');
  tocList.innerHTML = '';

  if (observer) {
    observer.disconnect();
  }

  if (headings.length === 0) return;

  const entries = buildTocEntries(headings);
  observer = createTocObserver(entries);
  headings.forEach((h) => observer!.observe(h));
}
