import * as assert from 'assert';
import * as vscode from 'vscode';
import { sanitizeExportHtml } from '../../export/htmlSanitizer';
import { StandaloneHtmlBuilder } from '../../export/standaloneHtmlBuilder';
import { CHROME_LAUNCH_ARGS, launchBrowser, renderInBrowser } from '../../export/pdfExporter';
import { findChromePath } from '../../export/browserFinder';

// Export pipeline security regression tests (issue #25): markdown rendered with
// `html: true` must never execute document JavaScript in the headless Chromium
// used for HTML/PDF export.

const MALICIOUS_HTML = [
  '<p>legit</p>',
  '<script>globalThis.__docPwned = true</script>',
  '<img src="missing.png" onerror="globalThis.__imgPwned = true">',
  '<a href="javascript:globalThis.__hrefPwned = true">click</a>',
  '<div onclick="globalThis.__clickPwned = true">x</div>',
  '<iframe src="https://evil.example"></iframe>',
  '<object data="evil.swf"></object>',
  '<embed src="evil.swf">',
  '<svg><script>globalThis.__svgPwned = true</script></svg>',
].join('\n');

function chromeAvailable(): boolean {
  try {
    findChromePath();
    return true;
  } catch {
    return false;
  }
}

suite('export pipeline JavaScript execution prevention (#25)', () => {
  suite('sanitizeExportHtml', () => {
    test('strips <script> elements in HTML and SVG contexts', async () => {
      const clean = await sanitizeExportHtml(
        '<p>ok</p><script>alert(1)</script><svg><script>alert(2)</script></svg>'
      );
      assert.ok(!/<script/i.test(clean), `script survived: ${clean}`);
      assert.ok(clean.includes('<p>ok</p>'));
      assert.ok(clean.includes('<svg>'));
    });

    test('strips inline event-handler attributes', async () => {
      const clean = await sanitizeExportHtml(
        '<img src="x.png" onerror="alert(1)"><div onclick="alert(2)">c</div>'
      );
      assert.ok(!/onerror/i.test(clean));
      assert.ok(!/onclick/i.test(clean));
      assert.ok(/<img[^>]*src="x\.png"/.test(clean));
    });

    test('strips javascript: URLs', async () => {
      const clean = await sanitizeExportHtml('<a href="javascript:alert(1)">x</a>');
      assert.ok(!/javascript:/i.test(clean));
      assert.ok(clean.includes('>x</a>'));
    });

    test('strips embedding and document-hijacking elements', async () => {
      const clean = await sanitizeExportHtml(
        '<iframe src="//e"></iframe><object data="e"></object><embed src="e">' +
          '<base href="//evil/"><meta http-equiv="refresh" content="0;url=//e">' +
          '<link rel="stylesheet" href="//e">'
      );
      assert.ok(!/<iframe/i.test(clean));
      assert.ok(!/<object/i.test(clean));
      assert.ok(!/<embed/i.test(clean));
      assert.ok(!/<base/i.test(clean));
      assert.ok(!/<meta/i.test(clean));
      assert.ok(!/<link/i.test(clean));
    });

    test('preserves legitimate rendered markup', async () => {
      const legit =
        '<h1 data-line="0" class="code-line">T</h1>' +
        '<input type="checkbox" data-line="3" checked> ' +
        '<div class="mermaid-block" data-processed="false" data-source="eA==">' +
        '<pre class="mermaid">graph TD</pre></div>' +
        '<span class="katex-inline" data-math="x">x</span>' +
        '<table><tr><td style="color:red">c</td></tr></table>' +
        '<img src="data:image/png;base64,iVBORw0KGgo=">' +
        '<a href="https://example.com">link</a>';
      const clean = await sanitizeExportHtml(legit);
      for (const fragment of [
        'data-line="0"',
        'type="checkbox"',
        'data-line="3"',
        'checked',
        'class="mermaid-block"',
        'data-source="eA=="',
        'data-math="x"',
        'style="color:red"',
        'src="data:image/png;base64,iVBORw0KGgo="',
        'href="https://example.com"',
      ]) {
        assert.ok(clean.includes(fragment), `lost legitimate markup: ${fragment}`);
      }
    });
  });

  suite('StandaloneHtmlBuilder.buildForBrowser', () => {
    const builder = new StandaloneHtmlBuilder(vscode.Uri.file('/nonexistent-extension-dir'));
    const docUri = vscode.Uri.file('/tmp/export-doc.md');

    test('document scripts and handlers never reach the export document', async () => {
      const html = await builder.buildForBrowser(MALICIOUS_HTML, 'doc', docUri);
      assert.ok(!html.includes('__docPwned'), 'document <script> survived');
      assert.ok(!/\son[a-z]+\s*=/i.test(html), 'event-handler attribute survived');
      assert.ok(!/javascript:/i.test(html), 'javascript: URL survived');
      assert.ok(!/<iframe/i.test(html));
      assert.ok(!/<object/i.test(html));
      assert.ok(!/<embed/i.test(html));
    });

    test('emits a CSP meta with per-export nonce and no unsafe-inline script-src', async () => {
      const html = await builder.buildForBrowser('<p>x</p>', 'doc', docUri);
      const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
      assert.ok(csp, 'CSP meta missing');
      const policy = csp![1];
      assert.ok(/script-src 'nonce-[^']+'/.test(policy), `no nonce in: ${policy}`);
      assert.ok(!/script-src[^;]*unsafe-inline/.test(policy), `unsafe-inline in: ${policy}`);
      assert.ok(/default-src 'none'/.test(policy));
    });

    test('every <script> tag carries the CSP nonce', async () => {
      const html = await builder.buildForBrowser('<p>x</p>', 'doc', docUri);
      const nonce = html.match(/script-src 'nonce-([^']+)'/)![1];
      const scriptTags = html.match(/<script\b[^>]*>/g) || [];
      assert.ok(scriptTags.length > 0, 'expected vendor/render scripts in the document');
      for (const tag of scriptTags) {
        assert.ok(
          tag.includes(`nonce="${nonce}"`),
          `script tag missing matching nonce: ${tag.slice(0, 80)}`
        );
      }
    });

    test('nonce is regenerated per export', async () => {
      const a = await builder.buildForBrowser('<p>x</p>', 'doc', docUri);
      const b = await builder.buildForBrowser('<p>x</p>', 'doc', docUri);
      const nonceA = a.match(/script-src 'nonce-([^']+)'/)![1];
      const nonceB = b.match(/script-src 'nonce-([^']+)'/)![1];
      assert.notStrictEqual(nonceA, nonceB);
    });
  });

  suite('Chromium launch flags', () => {
    test('never disables the Chromium sandbox', () => {
      for (const arg of CHROME_LAUNCH_ARGS) {
        assert.ok(
          !/no[-]sandbox|disable[-]setuid[-]sandbox/.test(arg),
          `sandbox-disabling flag present: ${arg}`
        );
      }
    });
  });

  suite('end-to-end in headless Chromium', function () {
    this.timeout(60000);

    test('document <script> does not execute and is absent from rendered output', async function () {
      if (!chromeAvailable()) {
        return this.skip();
      }
      const builder = new StandaloneHtmlBuilder(vscode.Uri.file('/nonexistent-extension-dir'));
      const html = await builder.buildForBrowser(
        '<p>body</p><script>document.title = "PWNED"; globalThis.__docPwned = true;</script>' +
          '<img src="nope.png" onerror="document.title = \'PWNED\'">',
        'safe-title',
        vscode.Uri.file('/tmp/export-doc.md')
      );
      const rendered = await renderInBrowser(html);
      assert.ok(
        rendered.includes('<title>safe-title</title>'),
        'document JavaScript executed and mutated the document'
      );
      assert.ok(!rendered.includes('PWNED'));
      assert.ok(!/<script\b/i.test(rendered), 'script element survived into rendered output');
    });

    test('CSP blocks non-nonced scripts even if one reaches the page', async function () {
      if (!chromeAvailable()) {
        return this.skip();
      }
      const browser = await launchBrowser();
      try {
        const page = await browser.newPage();
        await page.setContent(
          '<!DOCTYPE html><html><head>' +
            '<meta http-equiv="Content-Security-Policy" ' +
            "content=\"default-src 'none'; script-src 'nonce-testnonce'\">" +
            '</head><body>' +
            '<script>globalThis.__pwned = true</script>' +
            '<script nonce="testnonce">globalThis.__allowed = true</script>' +
            '</body></html>'
        );
        const pwned = await page.evaluate(() => (globalThis as Record<string, unknown>).__pwned);
        const allowed = await page.evaluate(
          () => (globalThis as Record<string, unknown>).__allowed
        );
        assert.strictEqual(pwned, undefined, 'non-nonced inline script executed under CSP');
        assert.strictEqual(allowed, true, 'nonced script was blocked by CSP');
      } finally {
        await browser.close();
      }
    });
  });
});
