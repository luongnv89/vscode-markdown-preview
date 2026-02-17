const COPY_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="5" y="5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.2"/>
  <path d="M3 11V3C3 2.44772 3.44772 2 4 2H10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
</svg>`;

const CHECK_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export function initCopyButtons(): void {
  addCopyButtons();
}

export function refreshCopyButtons(): void {
  addCopyButtons();
}

function addCopyButtons(): void {
  const codeBlocks = document.querySelectorAll(
    'pre.hljs:not(.mermaid), pre.code-block:not(.mermaid)'
  );

  codeBlocks.forEach((pre) => {
    // Skip if already wrapped
    if (pre.parentElement?.classList.contains('code-block-wrapper')) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';

    // Get language info
    const lang = pre.getAttribute('data-lang') || '';

    // Create header with language label and copy button
    const header = document.createElement('div');
    header.className = 'code-block-header';

    if (lang) {
      const langLabel = document.createElement('span');
      langLabel.className = 'code-block-lang';
      langLabel.textContent = lang;
      header.appendChild(langLabel);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-button';
    copyBtn.innerHTML = COPY_ICON;
    copyBtn.title = 'Copy code';
    copyBtn.addEventListener('click', () => handleCopy(pre, copyBtn));
    header.appendChild(copyBtn);

    pre.parentNode?.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  });
}

async function handleCopy(pre: Element, btn: HTMLButtonElement): Promise<void> {
  const code = pre.querySelector('code')?.textContent || pre.textContent || '';

  try {
    await navigator.clipboard.writeText(code);
    btn.innerHTML = CHECK_ICON;
    btn.classList.add('copied');

    setTimeout(() => {
      btn.innerHTML = COPY_ICON;
      btn.classList.remove('copied');
    }, 2000);
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = code;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);

    btn.innerHTML = CHECK_ICON;
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = COPY_ICON;
      btn.classList.remove('copied');
    }, 2000);
  }
}
