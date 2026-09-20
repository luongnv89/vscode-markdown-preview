let bar: HTMLElement | null = null;
let toggleButton: HTMLButtonElement | null = null;

export function initStatsBar(): void {
  bar = document.createElement('div');
  bar.className = 'stats-bar';
  bar.innerHTML = '<span class="stats-bar-item">0 words</span>';
  document.body.appendChild(bar);
}

export function setStatsToggleButton(button: HTMLButtonElement): void {
  toggleButton = button;
  toggleButton.setAttribute('aria-pressed', 'true');
}

export function toggleStats(): void {
  if (!bar) return;
  const isHidden = bar.classList.toggle('stats-hidden');
  toggleButton?.classList.toggle('stats-toggle-active', !isHidden);
  toggleButton?.setAttribute('aria-pressed', String(!isHidden));
}

// Per-block measurements cached on the element (issue #77): a block the
// incremental patch kept contributes its recorded counts, and only inserted
// blocks pay for a text read and split. Entries die with their nodes, so
// removed blocks need no bookkeeping.
interface BlockStats {
  len: number;
  runs: number;
  wsPrefix: number;
  wsSuffix: number;
}
const blockStats = new WeakMap<Element, BlockStats>();

function statsOf(el: Element): BlockStats {
  let s = blockStats.get(el);
  if (!s) {
    const text = el.textContent || '';
    const trimmed = text.trim();
    s = {
      len: text.length,
      runs: trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length,
      wsPrefix: text.length - text.trimStart().length,
      wsSuffix: text.length - text.trimEnd().length,
    };
    blockStats.set(el, s);
  }
  return s;
}

// Assemble whole-document stats from per-block counts. The engine joins
// block output with '\n', so the document text is the join of block texts —
// word counts are additive across that boundary, and the trimmed length is
// the sum plus separators minus the leading/trailing whitespace spans.
function documentStats(container: HTMLElement): { words: number; chars: number } {
  const children = Array.from(container.children);
  let words = 0;
  let textLen = 0;
  let leadWs = 0;
  let leading = true;
  for (const el of children) {
    const s = statsOf(el);
    words += s.runs;
    textLen += s.len;
    if (leading) {
      if (s.wsPrefix === s.len) {
        leadWs += s.len + 1;
      } else {
        leadWs += s.wsPrefix;
        leading = false;
      }
    }
  }
  let trailWs = 0;
  for (let i = children.length - 1; i >= 0; i--) {
    const s = statsOf(children[i]);
    if (s.wsSuffix === s.len) {
      trailWs += s.len + 1;
    } else {
      trailWs += s.wsSuffix;
      break;
    }
  }
  const chars = Math.max(0, textLen + Math.max(0, children.length - 1) - leadWs - trailWs);
  return { words, chars };
}

let lastStatsHtml = '';

export function refreshStats(): void {
  if (!bar) return;

  const container = document.getElementById('preview-content');
  if (!container) return;

  const { words, chars } = documentStats(container);
  const readingMinutes = Math.max(1, Math.ceil(words / 200));

  const html = [
    `<span class="stats-bar-item">${words.toLocaleString()} words</span>`,
    '<span class="stats-bar-separator">&middot;</span>',
    `<span class="stats-bar-item">${chars.toLocaleString()} chars</span>`,
    '<span class="stats-bar-separator">&middot;</span>',
    `<span class="stats-bar-item">${readingMinutes} min read</span>`,
  ].join('');
  if (html !== lastStatsHtml) {
    bar.innerHTML = html;
    lastStatsHtml = html;
  }
}
