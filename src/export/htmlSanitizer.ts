import createDOMPurify from 'dompurify';
import type { DOMPurify, WindowLike } from 'dompurify';
import type { DOMWindow } from 'jsdom';

/**
 * Sanitizes rendered markdown HTML before it is handed to the export browser.
 *
 * The markdown engine renders with `html: true`, so author-supplied markup
 * (including `<script>`, event-handler attributes, `javascript:` URLs and
 * embedding elements such as `<iframe>`) flows through verbatim. That markup
 * must never reach headless Chromium, where it would execute during
 * `page.setContent`.
 *
 * DOMPurify is the allowlist sanitizer here: it strips scripts, event
 * handlers, dangerous URL schemes and embedding elements while keeping the
 * benign markup the renderer legitimately emits (tables, images, task-list
 * checkboxes, inline styles, `data-*` attributes used by KaTeX/Mermaid
 * placeholders).
 *
 * A JSDOM window backs DOMPurify because sanitization runs in the extension
 * host (Node), not in a page. JSDOM is imported lazily so extension
 * activation does not pay its startup cost.
 */
let sanitizer: DOMPurify | undefined;

async function getSanitizer(): Promise<DOMPurify> {
  if (!sanitizer) {
    const { JSDOM } = await import('jsdom');
    const window: DOMWindow = new JSDOM('').window;
    sanitizer = createDOMPurify(window as unknown as WindowLike);
  }
  return sanitizer;
}

/**
 * Remove all executable or embedding markup from rendered markdown HTML.
 * The result is safe to embed in the export document loaded by headless
 * Chromium.
 */
export async function sanitizeExportHtml(html: string): Promise<string> {
  const purify = await getSanitizer();
  return purify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
  });
}
