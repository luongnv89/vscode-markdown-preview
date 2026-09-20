import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { findChromePath, ChromeNotFoundError } from '../../export/browserFinder';
import { launchBrowser } from '../../export/pdfExporter';

// Mermaid 12 rendering regression tests (issue #45): the vendored
// dist/webview/vendor/mermaid.min.js must still produce real SVG for the
// diagram types this extension's users write, under the same hardened
// securityLevel 'strict' + nonce-only CSP posture the preview enforces.
// Real rendering needs a browser engine — jsdom has no SVG layout — so this
// is gated on a system Chromium-based browser like the other headless tests.

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function chromeAvailable(): boolean {
  try {
    findChromePath();
    return true;
  } catch (err) {
    assert.ok(err instanceof ChromeNotFoundError);
    return false;
  }
}

suite('mermaid 12 diagram rendering (#45)', function () {
  this.timeout(90000);

  test('flowchart, sequence and class diagrams each produce SVG under strict + nonce CSP', async function () {
    if (!chromeAvailable()) {
      return this.skip();
    }
    const mermaidJs = readRepoFile('dist/webview/vendor/mermaid.min.js');
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      const html = `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-t1'; style-src 'unsafe-inline'; img-src data:">
<script nonce="t1">${mermaidJs}</script>
</head><body>
<script nonce="t1">
window.__result = (async () => {
  // Same initialize() options as webview/renderer.ts: strict security plus
  // the dagre layout + classic look pinned for pre-v12 parity.
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', layout: 'dagre', look: 'classic' });
  const cases = {
    flowchart: 'graph TD; A["start"]-->B{"decide"}; B-->C["end"]',
    sequence: 'sequenceDiagram; participant A; participant B; A->>B: hello; B-->>A: world',
    classDiagram:
      'classDiagram\\n  class Animal {\\n    +String name\\n    +speak()\\n  }\\n  Animal <|-- Dog',
  };
  const out = {};
  for (const [name, code] of Object.entries(cases)) {
    try {
      const rendered = await mermaid.render('m45-' + name, code);
      out[name] = { svg: /<svg[\\s>]/.test(rendered.svg), len: rendered.svg.length };
    } catch (err) {
      out[name] = { svg: false, error: String(err && err.message ? err.message : err) };
    }
  }
  return out;
})();
</script></body></html>`;
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const result = (await page.evaluate(
        () => (globalThis as Record<string, unknown>).__result
      )) as Record<string, { svg: boolean; len?: number; error?: string }>;
      for (const name of ['flowchart', 'sequence', 'classDiagram']) {
        const r = result[name];
        assert.ok(r, `no result for ${name}`);
        assert.ok(r.svg, `${name} produced no SVG: ${JSON.stringify(r)}`);
        assert.ok((r.len ?? 0) > 500, `${name} SVG suspiciously small: ${r.len}`);
      }
    } finally {
      await browser.close();
    }
  });
});
