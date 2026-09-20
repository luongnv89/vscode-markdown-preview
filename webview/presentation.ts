let overlay: HTMLElement | null = null;
let slides: HTMLElement[] = [];
let currentSlide = 0;
let hasSeparators = false;

// Shown when the document has no <hr> slide breaks (issue #70): explains the
// `---` convention instead of presenting one long scrolling slide silently.
const NO_SEPARATOR_HINT = 'Tip: add --- on its own line to split the document into slides.';
const EMPTY_DOCUMENT_HINT = 'This document is empty. ' + NO_SEPARATOR_HINT;

// Split content by <hr> elements into slide groups (cloned, so the live
// preview DOM is untouched). Tracks whether any separator was seen so the
// caller can explain the `---` convention on single-slide documents.
function collectSlides(container: HTMLElement): { groups: HTMLElement[]; sawHr: boolean } {
  const groups: HTMLElement[] = [];
  let currentGroup = document.createElement('div');
  let sawHr = false;

  const children = Array.from(container.cloneNode(true).childNodes);
  for (const node of children) {
    if (node.nodeType === 1 && (node as Element).tagName === 'HR') {
      sawHr = true;
      if (currentGroup.childNodes.length > 0) {
        groups.push(currentGroup);
      }
      currentGroup = document.createElement('div');
    } else {
      currentGroup.appendChild(node.cloneNode(true));
    }
  }
  if (currentGroup.childNodes.length > 0) {
    groups.push(currentGroup);
  }
  return { groups, sawHr };
}

// The presentation chrome: exit button, slide container, counter, nav hint.
function buildOverlay(): HTMLElement {
  const overlayEl = document.createElement('div');
  overlayEl.className = 'presentation-overlay';

  // Exit button
  const exitBtn = document.createElement('button');
  exitBtn.className = 'presentation-exit';
  exitBtn.innerHTML = '&times;';
  exitBtn.title = 'Exit presentation (Esc)';
  exitBtn.addEventListener('click', exitPresentation);
  overlayEl.appendChild(exitBtn);

  // Slide container
  const slideContainer = document.createElement('div');
  slideContainer.className = 'presentation-slide';
  slideContainer.id = 'presentation-slide-container';
  overlayEl.appendChild(slideContainer);

  // Counter
  const counter = document.createElement('div');
  counter.className = 'presentation-counter';
  counter.id = 'presentation-counter';
  overlayEl.appendChild(counter);

  // Nav hint
  const hint = document.createElement('div');
  hint.className = 'presentation-nav-hint';
  hint.textContent = '\u2190 \u2192 arrows \u00b7 Esc to exit';
  overlayEl.appendChild(hint);

  return overlayEl;
}

// An explanatory banner prepended to the slide area when the document has no
// `---` separators — including the empty document, where the button used to
// silently do nothing (issue #70).
function buildSeparatorNotice(): HTMLElement {
  const notice = document.createElement('div');
  notice.className = 'presentation-notice';
  notice.textContent = slides.length === 0 ? EMPTY_DOCUMENT_HINT : NO_SEPARATOR_HINT;
  return notice;
}

export function enterPresentation(): void {
  const container = document.getElementById('preview-content');
  if (!container) return;

  const collected = collectSlides(container);
  slides = collected.groups;
  hasSeparators = collected.sawHr;

  currentSlide = 0;
  overlay = buildOverlay();
  document.body.appendChild(overlay);
  document.addEventListener('keydown', handlePresentationKey);

  renderSlide();
}

function exitPresentation(): void {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  document.removeEventListener('keydown', handlePresentationKey);
  slides = [];
  currentSlide = 0;
  hasSeparators = false;
}

// The per-slide fade also honours prefers-reduced-motion (issue #70): the
// matching CSS animation lives behind `no-preference`, so the inline style
// must be skipped entirely when the user asked for reduced motion.
function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function renderSlide(): void {
  const slideContainer = document.getElementById('presentation-slide-container');
  const counter = document.getElementById('presentation-counter');
  if (!slideContainer || !counter) return;

  slideContainer.innerHTML = '';
  const wrapper = document.createElement('div');
  if (!prefersReducedMotion()) {
    wrapper.style.animation = 'slide-fade-in 0.25s ease';
  }

  if (!hasSeparators) {
    wrapper.appendChild(buildSeparatorNotice());
  }
  if (slides.length === 0) {
    counter.textContent = '';
  } else {
    wrapper.appendChild(slides[currentSlide].cloneNode(true));
    counter.textContent = `${currentSlide + 1} / ${slides.length}`;
  }
  slideContainer.appendChild(wrapper);
}

function handlePresentationKey(e: KeyboardEvent): void {
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case ' ':
      e.preventDefault();
      if (currentSlide < slides.length - 1) {
        currentSlide++;
        renderSlide();
      }
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      e.preventDefault();
      if (currentSlide > 0) {
        currentSlide--;
        renderSlide();
      }
      break;
    case 'Escape':
      e.preventDefault();
      exitPresentation();
      break;
  }
}
