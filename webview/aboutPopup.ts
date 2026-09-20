import { infoIcon } from './icons';
import { createButton } from './domUtils';

export function createAboutButton(toolbar: HTMLElement): HTMLButtonElement {
  let aboutPopup: HTMLDivElement | null = null;

  function dismissAbout() {
    if (aboutPopup) {
      aboutPopup.remove();
      aboutPopup = null;
    }
  }

  const aboutButton = createButton(infoIcon, 'About', () => {
    if (aboutPopup) {
      dismissAbout();
      return;
    }

    const { version, commit, publisher, repo } = document.body.dataset;
    const versionText = [version, commit].filter(Boolean).join(' (') + (commit ? ')' : '');

    // Build with DOM APIs + textContent: the data-* values come from the host
    // document and must never be parsed as markup (innerHTML would turn a
    // crafted value into live HTML).
    aboutPopup = document.createElement('div');
    aboutPopup.className = 'about-popup';

    const title = document.createElement('div');
    title.className = 'about-title';
    title.textContent = 'Markdown Preview Pro';
    aboutPopup.appendChild(title);

    const maintainerRow = document.createElement('div');
    maintainerRow.className = 'about-row';
    const maintainerLabel = document.createElement('span');
    maintainerLabel.className = 'about-label';
    maintainerLabel.textContent = 'Maintainer:';
    maintainerRow.appendChild(maintainerLabel);
    maintainerRow.appendChild(document.createTextNode(' ' + (publisher || 'unknown')));
    aboutPopup.appendChild(maintainerRow);

    const repoRow = document.createElement('div');
    repoRow.className = 'about-row';
    const repoLabel = document.createElement('span');
    repoLabel.className = 'about-label';
    repoLabel.textContent = 'Repository:';
    repoRow.appendChild(repoLabel);
    repoRow.appendChild(document.createTextNode(' '));
    const repoLink = document.createElement('a');
    // Only http(s) repo URLs become links — anything else degrades to '#'.
    repoLink.href = repo && /^https?:\/\//.test(repo) ? repo : '#';
    repoLink.textContent = repo ? repo.replace(/^https?:\/\//, '') : 'N/A';
    repoRow.appendChild(repoLink);
    aboutPopup.appendChild(repoRow);

    const versionRow = document.createElement('div');
    versionRow.className = 'about-row';
    const versionLabel = document.createElement('span');
    versionLabel.className = 'about-label';
    versionLabel.textContent = 'Version:';
    versionRow.appendChild(versionLabel);
    versionRow.appendChild(document.createTextNode(' ' + (versionText || 'unknown')));
    aboutPopup.appendChild(versionRow);

    toolbar.appendChild(aboutPopup);
  });

  // Dismiss popup on click outside
  document.addEventListener('click', (e) => {
    if (
      aboutPopup &&
      !aboutPopup.contains(e.target as Node) &&
      e.target !== aboutButton &&
      !aboutButton.contains(e.target as Node)
    ) {
      dismissAbout();
    }
  });

  return aboutButton;
}
