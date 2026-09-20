import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import katex from 'katex';
import { MarkdownEngine } from '../../markdownEngine';
import { StandaloneHtmlBuilder } from '../../export/standaloneHtmlBuilder';
import { PreviewConfig } from '../../types/messages';

// KaTeX 0.18 regression tests (issue #47): pre-1.0 minors are breaking under
// semver — 0.18 prefixed internal CSS classes — so both the rendered HTML
// structure and the export-time font embedding need explicit coverage.

const repoRoot = path.resolve(__dirname, '..', '..', '..');

const BASE_CONFIG: PreviewConfig = {
  scrollSync: true,
  enableMermaid: true,
  enableKatex: true,
  enableCheckboxes: true,
  enableExcalidraw: true,
  lineBreaks: false,
  typographer: false,
  showFrontmatter: 'card',
  allowRemoteImages: false,
};

suite('katex 0.18 math rendering (#47)', () => {
  test('inline and display math render to KaTeX HTML structure', () => {
    const inline = katex.renderToString('a^2 + b^2 = c^2', {
      throwOnError: false,
      displayMode: false,
    });
    assert.ok(/class="katex"/.test(inline), `no .katex root in inline render: ${inline}`);
    assert.ok(!/class="katex-display"/.test(inline), 'inline render is display-mode');

    const display = katex.renderToString('\\int_0^1 x^2 \\, dx = \\frac{1}{3}', {
      throwOnError: false,
      displayMode: true,
    });
    assert.ok(/class="katex"/.test(display), `no .katex root in display render`);
    assert.ok(/katex-display/.test(display), `display mode lost .katex-display: ${display}`);
  });

  test('the engine still emits katex placeholders for inline and block math', () => {
    const engine = new MarkdownEngine({ ...BASE_CONFIG });
    const { html } = engine.render('inline $x+y$ math\n\n$$\nE = mc^2\n$$\n');
    assert.ok(html.includes('class="katex-inline"'), `no katex-inline span: ${html}`);
    assert.ok(html.includes('data-math="x+y"'), `inline math content lost: ${html}`);
    assert.ok(html.includes('class="katex-block'), `no katex-block div: ${html}`);
    assert.ok(html.includes('data-math="E = mc^2"'), `block math content lost: ${html}`);
  });

  test('export embeds every KaTeX font url(...) as a non-empty data URI', async () => {
    const engine = new MarkdownEngine({ ...BASE_CONFIG });
    const { html: markdownHtml } = engine.render('inline $x+y$ math\n\n$$\nE = mc^2\n$$\n');
    const builder = new StandaloneHtmlBuilder(vscode.Uri.file(repoRoot));
    const doc = await builder.buildForBrowser(
      markdownHtml,
      'math-doc',
      vscode.Uri.file('/tmp/export-doc.md')
    );

    // No surviving relative font reference — every url(fonts/...) the KaTeX
    // CSS emitted must have been inlined by the export builder.
    assert.ok(
      !/url\(\s*['"]?(?:\.\/)?fonts\//.test(doc),
      'unembedded url(fonts/…) reference survived in export'
    );

    const dataFontUrls = doc.match(/url\(data:font\/[^)]+\)/g) || [];
    assert.ok(dataFontUrls.length > 0, 'no url(data:font/…) embedded in export');
    for (const ref of dataFontUrls) {
      const base64 = ref.replace(/^url\(data:font\/[^;]+;base64,/, '').replace(/\)$/, '');
      const decoded = Buffer.from(base64, 'base64');
      assert.ok(decoded.length > 0, `empty embedded font payload: ${ref.slice(0, 60)}`);
    }
  });
});
