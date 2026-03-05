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
}

export function toggleStats(): void {
  if (!bar) return;
  const isHidden = bar.classList.toggle('stats-hidden');
  toggleButton?.classList.toggle('stats-toggle-active', !isHidden);
}

export function refreshStats(): void {
  if (!bar) return;

  const container = document.getElementById('preview-content');
  if (!container) return;

  const text = container.textContent || '';
  const trimmed = text.trim();

  const words = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  const chars = trimmed.length;
  const readingMinutes = Math.max(1, Math.ceil(words / 200));

  bar.innerHTML = [
    `<span class="stats-bar-item">${words.toLocaleString()} words</span>`,
    '<span class="stats-bar-separator">&middot;</span>',
    `<span class="stats-bar-item">${chars.toLocaleString()} chars</span>`,
    '<span class="stats-bar-separator">&middot;</span>',
    `<span class="stats-bar-item">${readingMinutes} min read</span>`,
  ].join('');
}
