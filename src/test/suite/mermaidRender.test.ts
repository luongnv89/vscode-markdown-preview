import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { findChromePath, ChromeNotFoundError } from '../../export/browserFinder';
import { launchBrowser } from '../../export/pdfExporter';

// Mermaid rendering regression tests (issues #45, #156): Mermaid fences render
// through pele, vendored as dist/webview/vendor/pele.min.js. It must produce
// real SVG for the diagram types this extension's users write, in a real
// browser, under the same nonce-only CSP the preview enforces (no
// 'unsafe-eval'). The SVG has to be laid out to be checked, so these tests
// need a system Chromium-based browser like the other headless tests.

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

suite('mermaid diagram rendering via pele (#45, #156)', function () {
  this.timeout(90000);

  test('flowchart, sequence and class diagrams each produce SVG under the nonce-only CSP', async function () {
    if (!chromeAvailable()) {
      return this.skip();
    }
    const peleJs = readRepoFile('dist/webview/vendor/pele.min.js');
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      const html = `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-t1'; style-src 'unsafe-inline'; img-src data:">
<script nonce="t1">${peleJs}</script>
</head><body><div id="out"></div>
<script nonce="t1">
window.__result = (() => {
  const cases = {
    flowchart: 'graph TD; A["start"]-->B{"decide"}; B-->C["end"]',
    sequence: 'sequenceDiagram; participant A; participant B; A->>B: hello; B-->>A: world',
    classDiagram:
      'classDiagram\\n  class Animal {\\n    +String name\\n    +speak()\\n  }\\n  Animal <|-- Dog',
  };
  const out = {};
  for (const [name, code] of Object.entries(cases)) {
    try {
      // Same options as webview/renderer.ts.
      const rendered = pele.render(code, { idPrefix: 'm156-' + name + '-', links: false });
      const host = document.getElementById('out');
      host.innerHTML = rendered.svg;
      const svg = host.querySelector('svg');
      const box = svg ? svg.getBBox() : { width: 0, height: 0 };
      out[name] = {
        svg: /<svg[\\s>]/.test(rendered.svg),
        len: rendered.svg.length,
        type: rendered.type,
        laidOut: box.width > 0 && box.height > 0,
      };
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
      )) as Record<
        string,
        { svg: boolean; len?: number; type?: string; laidOut?: boolean; error?: string }
      >;
      const expectedTypes: Record<string, string> = {
        flowchart: 'flowchart',
        sequence: 'sequence',
        classDiagram: 'class',
      };
      for (const name of ['flowchart', 'sequence', 'classDiagram']) {
        const r = result[name];
        assert.ok(r, `no result for ${name}`);
        assert.ok(r.svg, `${name} produced no SVG: ${JSON.stringify(r)}`);
        assert.ok((r.len ?? 0) > 500, `${name} SVG suspiciously small: ${r.len}`);
        assert.strictEqual(r.type, expectedTypes[name]);
        assert.ok(r.laidOut, `${name} SVG has an empty bounding box`);
      }
    } finally {
      await browser.close();
    }
  });

  test('diagram colours follow a light/dark theme switch without a re-render (AC3)', async function () {
    if (!chromeAvailable()) {
      return this.skip();
    }
    const peleJs = readRepoFile('dist/webview/vendor/pele.min.js');
    // The bundled stylesheet the preview, the exports and the landing page all
    // load — mermaid.css's --pele-* declarations included.
    const mainCss = readRepoFile('dist/webview/main.css');
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      const html = `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-t1'; style-src 'unsafe-inline'; img-src data:">
<style>${mainCss}</style>
<script nonce="t1">${peleJs}</script>
</head><body class="vscode-dark"><div id="preview-content">
<div class="mermaid-block mermaid-rendered" id="flow"></div>
<div class="mermaid-block mermaid-rendered" id="pie"></div>
</div>
<script nonce="t1">
const THEMES = {
  dark: { cls: 'vscode-dark', bg: '#1e1e1e', fg: '#d4d4d4' },
  light: { cls: 'vscode-light', bg: '#ffffff', fg: '#000000' },
};
// VS Code sets its theme variables on <html> and the theme class on <body>.
function applyTheme(name) {
  const t = THEMES[name];
  document.body.className = t.cls;
  document.documentElement.style.setProperty('--vscode-editor-background', t.bg);
  document.documentElement.style.setProperty('--vscode-editor-foreground', t.fg);
}
// Normalize rgb(...) / color(srgb ...) computed colours to 0-255 channels.
function channels(value) {
  const nums = (value.match(/[\\d.]+/g) || []).map(Number);
  return value.startsWith('color(') ? nums.slice(0, 3).map((n) => Math.round(n * 255)) : nums.slice(0, 3);
}
function sample() {
  const node = document.querySelector('#flow .pele-node rect');
  const slice = document.querySelector('#pie .pele-slice');
  return {
    surface: channels(getComputedStyle(node).fill),
    text: channels(getComputedStyle(document.querySelector('#flow svg')).color),
    series1: channels(getComputedStyle(slice).fill),
  };
}
applyTheme('dark');
document.getElementById('flow').innerHTML = pele.render('flowchart LR\\n A --> B', { links: false }).svg;
document.getElementById('pie').innerHTML = pele.render('pie\\n "a" : 1\\n "b" : 2', { links: false }).svg;
const flowSvg = document.querySelector('#flow svg');
const dark = sample();
applyTheme('light');
const light = sample();
window.__result = { dark, light, sameNode: document.querySelector('#flow svg') === flowSvg };
</script></body></html>`;
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const result = (await page.evaluate(
        () => (globalThis as Record<string, unknown>).__result
      )) as {
        dark: { surface: number[]; text: number[]; series1: number[] };
        light: { surface: number[]; text: number[]; series1: number[] };
        sameNode: boolean;
      };
      const mean = (c: number[]): number => (c[0] + c[1] + c[2]) / 3;
      assert.strictEqual(result.sameNode, true, 'the SVG was replaced — not a pure CSS recolour');
      // Dark: node surface is a dark tone (6% of fg into bg), text is light.
      assert.ok(mean(result.dark.surface) < 80, `dark surface ${result.dark.surface}`);
      assert.ok(mean(result.dark.surface) > 30, `dark surface equals the page bg`);
      assert.ok(mean(result.dark.text) > 180, `dark text ${result.dark.text}`);
      // Light: the same nodes, recoloured by the class swap alone.
      assert.ok(mean(result.light.surface) > 220, `light surface ${result.light.surface}`);
      assert.ok(mean(result.light.surface) < 255, 'light surface equals the page bg');
      assert.ok(mean(result.light.text) < 60, `light text ${result.light.text}`);
      // Series colours switch to the dark-readable tone and back.
      assert.deepStrictEqual(result.dark.series1, [121, 166, 220]);
      assert.deepStrictEqual(result.light.series1, [59, 106, 158]);
    } finally {
      await browser.close();
    }
  });
});
