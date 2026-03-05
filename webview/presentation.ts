let overlay: HTMLElement | null = null;
let slides: HTMLElement[] = [];
let currentSlide = 0;

export function initPresentation(): void {
  // Nothing to initialize upfront; presentation is created on demand
}

export function enterPresentation(): void {
  const container = document.getElementById('preview-content');
  if (!container) return;

  // Split content by <hr> elements into slides
  slides = [];
  let currentGroup = document.createElement('div');

  const children = Array.from(container.cloneNode(true).childNodes);
  for (const node of children) {
    if (node instanceof HTMLHRElement) {
      if (currentGroup.childNodes.length > 0) {
        slides.push(currentGroup);
      }
      currentGroup = document.createElement('div');
    } else {
      currentGroup.appendChild(node.cloneNode(true));
    }
  }
  if (currentGroup.childNodes.length > 0) {
    slides.push(currentGroup);
  }

  if (slides.length === 0) return;

  currentSlide = 0;

  // Create overlay
  overlay = document.createElement('div');
  overlay.className = 'presentation-overlay';

  // Exit button
  const exitBtn = document.createElement('button');
  exitBtn.className = 'presentation-exit';
  exitBtn.innerHTML = '&times;';
  exitBtn.title = 'Exit presentation (Esc)';
  exitBtn.addEventListener('click', exitPresentation);
  overlay.appendChild(exitBtn);

  // Slide container
  const slideContainer = document.createElement('div');
  slideContainer.className = 'presentation-slide';
  slideContainer.id = 'presentation-slide-container';
  overlay.appendChild(slideContainer);

  // Counter
  const counter = document.createElement('div');
  counter.className = 'presentation-counter';
  counter.id = 'presentation-counter';
  overlay.appendChild(counter);

  // Nav hint
  const hint = document.createElement('div');
  hint.className = 'presentation-nav-hint';
  hint.textContent = '\u2190 \u2192 arrows \u00b7 Esc to exit';
  overlay.appendChild(hint);

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
}

function renderSlide(): void {
  const slideContainer = document.getElementById('presentation-slide-container');
  const counter = document.getElementById('presentation-counter');
  if (!slideContainer || !counter) return;

  // Force re-animation by replacing content
  slideContainer.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.style.animation = 'slide-fade-in 0.25s ease';
  wrapper.appendChild(slides[currentSlide].cloneNode(true));
  slideContainer.appendChild(wrapper);

  counter.textContent = `${currentSlide + 1} / ${slides.length}`;
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
