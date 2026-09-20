import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildWebviewHtml, escapeHtmlAttr } from '../../utils/webviewHtml';
import { findChromePath, ChromeNotFoundError } from '../../export/browserFinder';
import { launchBrowser } from '../../export/pdfExporter';

// Preview-webview security regression tests (issues #26, #29):
// - #26: Mermaid securityLevel 'strict' + no 'unsafe-eval' in the preview CSP.
// - #29: <body data-*> metadata escaped on write, About popup built with
//   textContent, and img-src restricted unless the documented opt-in is on.

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

const ABOUT_INFO = {
  version: '0.9.4',
  publisher: 'luongnv89',
  repo: 'https://github.com/luongnv89/vscode-markdown-preview',
  commit: 'a503be1',
};

const STUB_WEBVIEW = {
  cspSource: 'vscode-webview-resource:',
  asWebviewUri: (uri: vscode.Uri) => uri,
};

function extractCsp(html: string): string {
  const match = html.match(/<meta http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  assert.ok(match, 'CSP meta missing');
  return match![1];
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

suite('preview webview security (#26, #29)', () => {
  suite('webview CSP', () => {
    test('script-src is nonce-only — no unsafe-eval (#26)', () => {
      const csp = extractCsp(
        buildWebviewHtml(STUB_WEBVIEW, vscode.Uri.file(repoRoot), ABOUT_INFO, false)
      );
      assert.ok(/script-src 'nonce-[^']+'/.test(csp), `no nonce in: ${csp}`);
      assert.ok(!/unsafe-eval/.test(csp), `unsafe-eval present in: ${csp}`);
      assert.ok(/default-src 'none'/.test(csp));
      assert.ok(/worker-src 'none'/.test(csp));
      assert.ok(/frame-src 'none'/.test(csp));
    });

    test('img-src is restricted to the webview scheme and data: by default (#29)', () => {
      const csp = extractCsp(
        buildWebviewHtml(STUB_WEBVIEW, vscode.Uri.file(repoRoot), ABOUT_INFO, false)
      );
      const imgSrc = csp.match(/img-src [^;]+/);
      assert.ok(imgSrc, 'img-src directive missing');
      assert.ok(!/https?:/.test(imgSrc![0]), `remote image scheme allowed: ${imgSrc![0]}`);
      assert.ok(imgSrc![0].includes(STUB_WEBVIEW.cspSource));
      assert.ok(imgSrc![0].includes('data:'));
    });

    test('img-src admits https: only with the allowRemoteImages opt-in (#29)', () => {
      const csp = extractCsp(
        buildWebviewHtml(STUB_WEBVIEW, vscode.Uri.file(repoRoot), ABOUT_INFO, true)
      );
      const imgSrc = csp.match(/img-src [^;]+/);
      assert.ok(imgSrc, 'img-src directive missing');
      assert.ok(/https:/.test(imgSrc![0]), `opt-in https: missing: ${imgSrc![0]}`);
    });
  });

  suite('metadata escaping (#29)', () => {
    test('escapeHtmlAttr escapes attribute-breaking characters', () => {
      const hostile = '"><img src=x onerror=alert(1)>';
      const escaped = escapeHtmlAttr(hostile);
      assert.ok(!escaped.includes('"'));
      assert.ok(!escaped.includes('<'));
      assert.ok(!escaped.includes('>'));
      assert.strictEqual(escaped, '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
      assert.strictEqual(escapeHtmlAttr("a&b'c"), 'a&amp;b&#39;c');
    });

    test('a metadata value containing an img-onerror payload is rendered inert (#29)', () => {
      const hostile = '"><img src=x onerror=alert(1)>';
      const html = buildWebviewHtml(
        STUB_WEBVIEW,
        vscode.Uri.file(repoRoot),
        { ...ABOUT_INFO, version: hostile, publisher: hostile, repo: hostile, commit: hostile },
        false
      );
      const bodyTag = html.match(/<body[^>]*>/)![0];
      assert.ok(!bodyTag.includes(hostile), `unescaped metadata in: ${bodyTag}`);
      assert.ok(bodyTag.includes('data-version="&quot;&gt;&lt;img'));
      // The escaped text must stay inside the attribute: no <img element can
      // be parsed out of the body tag.
      assert.ok(!/<img/i.test(bodyTag));
    });

    test('About popup is built with textContent, not innerHTML (#29)', () => {
      const src = readRepoFile('webview/aboutPopup.ts');
      assert.ok(
        !/aboutPopup\.innerHTML/.test(src),
        'aboutPopup.innerHTML still present in webview/aboutPopup.ts'
      );
      // The About block must not assign innerHTML at all.
      const aboutBlock = src.slice(src.indexOf('aboutButton'), src.indexOf('Dismiss popup'));
      assert.ok(!/\.innerHTML\s*=/.test(aboutBlock), 'innerHTML assignment inside About path');
      assert.ok(/\.textContent\s*=/.test(aboutBlock), 'textContent missing from About path');
    });
  });

  suite('mermaid securityLevel (#26)', () => {
    test('both call sites initialize Mermaid with strict, none with loose', () => {
      const renderer = readRepoFile('webview/renderer.ts');
      const exporter = readRepoFile('src/export/standaloneHtmlBuilder.ts');
      for (const [name, src] of [
        ['webview/renderer.ts', renderer],
        ['src/export/standaloneHtmlBuilder.ts', exporter],
      ] as const) {
        assert.ok(/securityLevel:\s*'strict'/.test(src), `${name} missing 'strict'`);
        assert.ok(!/securityLevel:\s*'loose'/.test(src), `${name} still uses 'loose'`);
      }
    });

    test('previewManager.ts carries no unsafe-eval in its CSP', () => {
      const src = readRepoFile('src/previewManager.ts');
      assert.ok(!/unsafe-eval/.test(src), 'unsafe-eval still present in src/previewManager.ts');
      assert.ok(/buildWebviewHtml/.test(src), 'previewManager must delegate CSP construction');
    });
  });

  suite('mermaid under the hardened CSP (headless Chromium, #26)', function () {
    this.timeout(60000);

    test('renders a diagram with a click JS directive under strict + nonce-only CSP, attaching no handler', async function () {
      if (!chromeAvailable()) {
        return this.skip();
      }
      const mermaidJs = readRepoFile('dist/webview/vendor/mermaid.min.js');
      const browser = await launchBrowser();
      try {
        const page = await browser.newPage();
        // Same policy shape as the preview CSP: nonce-only script-src, no
        // 'unsafe-eval' — proves Mermaid 11.x needs no eval to render.
        const html = `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-t1'; style-src 'unsafe-inline'; img-src data:">
<script nonce="t1">${mermaidJs}</script>
</head><body><div id="out"></div>
<script nonce="t1">
window.__pwned = false;
window.doPwn = function () { window.__pwned = true; };
window.__result = (async () => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
  const { svg, bindFunctions } = await mermaid.render(
    'd1',
    'graph TD; A["<img src=x onerror=doPwn()>"]-->B; click A doPwn "tip"'
  );
  document.getElementById('out').innerHTML = svg;
  if (typeof bindFunctions === 'function') { bindFunctions(document.getElementById('out')); }
  document.querySelectorAll('#out .node, #out a, #out g').forEach((el) => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await new Promise((res) => setTimeout(res, 200));
  return {
    svgLen: svg.length,
    hasJs: /<script|javascript:|onerror=/i.test(svg),
    pwned: window.__pwned,
  };
})();
</script></body></html>`;
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        const result = (await page.evaluate(
          () => (globalThis as Record<string, unknown>).__result
        )) as { svgLen: number; hasJs: boolean; pwned: boolean };
        assert.ok(result.svgLen > 500, 'mermaid diagram did not render under nonce-only CSP');
        assert.strictEqual(result.hasJs, false, 'scriptable markup survived in rendered SVG');
        assert.strictEqual(result.pwned, false, 'click directive attached a live handler');
      } finally {
        await browser.close();
      }
    });
  });
});
