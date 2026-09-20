import { infoIcon } from './icons';
import { createButton } from './domUtils';

export function createAboutButton(toolbar: HTMLElement): HTMLButtonElement {
  let aboutPopup: HTMLDivElement | null = null;

  function dismissAbout() {
    if (aboutPopup) {
      aboutPopup.remove();
      aboutPopup = null;
      aboutButton.setAttribute('aria-expanded', 'false');
    }
  }

  const aboutButton = createButton(infoIcon, 'About', () => {
    if (aboutPopup) {
      dismissAbout();
      return;
    }
    aboutPopup = buildAboutPopup();
    toolbar.appendChild(aboutPopup);
    aboutButton.setAttribute('aria-expanded', 'true');
  });
  aboutButton.setAttribute('aria-expanded', 'false');

  watchOutsideClicks(aboutButton, () => aboutPopup, dismissAbout);

  return aboutButton;
}

// One labelled row of the popup: <span class="about-label">Label:</span>
// followed by the caller-supplied value nodes, DOM-built like everything else
// here so dataset values are never parsed as markup.
function aboutRow(label: string, ...valueNodes: Node[]): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'about-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'about-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);
  for (const node of valueNodes) {
    row.appendChild(node);
  }
  return row;
}

// Build with DOM APIs + textContent: the data-* values come from the host
// document and must never be parsed as markup (innerHTML would turn a
// crafted value into live HTML).
function buildAboutPopup(): HTMLDivElement {
  const { version, commit, publisher, repo } = document.body.dataset;
  const versionText = [version, commit].filter(Boolean).join(' (') + (commit ? ')' : '');

  const popup = document.createElement('div');
  popup.className = 'about-popup';

  const title = document.createElement('div');
  title.className = 'about-title';
  title.textContent = 'Markdown Preview Pro';
  popup.appendChild(title);

  popup.appendChild(
    aboutRow('Maintainer:', document.createTextNode(' ' + (publisher || 'unknown')))
  );

  const repoLink = document.createElement('a');
  // Only http(s) repo URLs become links — anything else degrades to '#'.
  repoLink.href = repo && /^https?:\/\//.test(repo) ? repo : '#';
  repoLink.textContent = repo ? repo.replace(/^https?:\/\//, '') : 'N/A';
  popup.appendChild(aboutRow('Repository:', document.createTextNode(' '), repoLink));

  popup.appendChild(
    aboutRow('Version:', document.createTextNode(' ' + (versionText || 'unknown')))
  );

  return popup;
}

// Dismiss popup on click outside
function watchOutsideClicks(
  aboutButton: HTMLElement,
  getPopup: () => HTMLDivElement | null,
  dismiss: () => void
): void {
  document.addEventListener('click', (e) => {
    const popup = getPopup();
    if (
      popup &&
      !popup.contains(e.target as Node) &&
      e.target !== aboutButton &&
      !aboutButton.contains(e.target as Node)
    ) {
      dismiss();
    }
  });
}
