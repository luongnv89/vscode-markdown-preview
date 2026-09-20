import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { MarkdownEngine } from '../../markdownEngine';
import { StandaloneHtmlBuilder } from '../../export/standaloneHtmlBuilder';
import { generatePdf, renderInBrowser } from '../../export/pdfExporter';
import { findChromePath } from '../../export/browserFinder';
import { PreviewConfig } from '../../types/messages';

// Export asset gating regression tests (issue #74): an export must embed only
// the vendor runtimes the rendered document actually uses. A document with no
// math embeds no KaTeX script, stylesheet or base64 fonts; a document with no
// mermaid/excalidraw blocks reads neither diagram bundle from disk.

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

const MATH_MD = 'inline $x+y$ math\n\n$$\nE = mc^2\n$$\n';
const MERMAID_MD = '```mermaid\ngraph TD; A["start"]-->B["end"]\n```\n';
const EXCALIDRAW_MD = '```excalidraw\n{"elements": []}\n```\n';
const PLAIN_MD = '# Title\n\nSome plain text with `code` and a list:\n\n- one\n- two\n';

const VENDOR_BUNDLE = /(?:^|[/\\])(katex\.min\.js|mermaid\.min\.js|excalidraw-utils\.min\.js)$/;
const KATEX_CSS = /(?:^|[/\\])katex\.min\.css$/;
const FONT_FILE = /[/\\]fonts[/\\]/;

// Records every file the builder opens, then delegates to the real read so
// the build still produces a working document. The gating contract is about
// the read, not the embed: stripping removes scripts from the saved output,
// so only the disk access proves a runtime was not pulled in.
function recordingReader(reads: string[]): (filePath: string) => Promise<Buffer> {
  return (filePath: string) => {
    reads.push(filePath);
    return fs.promises.readFile(filePath);
  };
}

function chromeAvailable(): boolean {
  try {
    findChromePath();
    return true;
  } catch {
    return false;
  }
}

function countDataFontUrls(doc: string): number {
  return (doc.match(/url\(data:font\//g) || []).length;
}

suite('export asset gating (#74)', () => {
  const docUri = vscode.Uri.file('/tmp/export-doc.md');

  suite('disk reads', () => {
    test('a document with no math and no diagrams reads none of the vendor bundles', async () => {
      const engine = new MarkdownEngine({ ...BASE_CONFIG });
      const { html } = engine.render(PLAIN_MD);
      const reads: string[] = [];
      const builder = new StandaloneHtmlBuilder(
        vscode.Uri.file(repoRoot),
        () => {},
        recordingReader(reads)
      );
      await builder.buildForBrowser(html, 'plain', docUri);

      for (const p of reads) {
        assert.ok(!VENDOR_BUNDLE.test(p), `vendor bundle read for plain doc: ${p}`);
        assert.ok(!KATEX_CSS.test(p), `katex stylesheet read for plain doc: ${p}`);
        assert.ok(!FONT_FILE.test(p), `font file read for plain doc: ${p}`);
      }
      // Sanity that the spy was actually observing reads, not a dead channel.
      assert.ok(
        reads.some((p) => p.endsWith('main.css')),
        `expected main.css to be read, saw: ${JSON.stringify(reads)}`
      );
    });

    test('a document using every feature reads all three vendor bundles', async () => {
      const engine = new MarkdownEngine({ ...BASE_CONFIG });
      const { html } = engine.render(MATH_MD + '\n' + MERMAID_MD + '\n' + EXCALIDRAW_MD);
      const reads: string[] = [];
      const builder = new StandaloneHtmlBuilder(
        vscode.Uri.file(repoRoot),
        () => {},
        recordingReader(reads)
      );
      await builder.buildForBrowser(html, 'full', docUri);

      for (const name of ['katex.min.js', 'mermaid.min.js', 'excalidraw-utils.min.js']) {
        assert.ok(
          reads.some((p) => p.endsWith(name)),
          `expected ${name} to be read, saw: ${JSON.stringify(reads)}`
        );
      }
      assert.ok(
        reads.some((p) => KATEX_CSS.test(p)),
        'katex.min.css not read for math doc'
      );
      assert.ok(
        reads.some((p) => FONT_FILE.test(p)),
        'no font files read for a document with math'
      );
    });

    test('feature flags still gate the read when markup is present', async () => {
      const engine = new MarkdownEngine({ ...BASE_CONFIG });
      const { html } = engine.render(MATH_MD + '\n' + MERMAID_MD);
      const reads: string[] = [];
      const builder = new StandaloneHtmlBuilder(
        vscode.Uri.file(repoRoot),
        () => {},
        recordingReader(reads)
      );
      await builder.buildForBrowser(html, 'flagged', docUri, {
        enableKatex: false,
        enableMermaid: false,
        enableExcalidraw: false,
      });

      for (const p of reads) {
        assert.ok(!VENDOR_BUNDLE.test(p), `vendor bundle read despite flag off: ${p}`);
        assert.ok(!KATEX_CSS.test(p), `katex stylesheet read despite flag off: ${p}`);
        assert.ok(!FONT_FILE.test(p), `font file read despite flag off: ${p}`);
      }
    });
  });

  suite('embedded payload', () => {
    test('a document with no math embeds zero base64 font data', async () => {
      const engine = new MarkdownEngine({ ...BASE_CONFIG });
      const { html } = engine.render(PLAIN_MD + '\n' + MERMAID_MD);
      const builder = new StandaloneHtmlBuilder(vscode.Uri.file(repoRoot));
      const doc = await builder.buildForBrowser(html, 'no-math', docUri);

      assert.strictEqual(
        countDataFontUrls(doc),
        0,
        'font data embedded for a document without math'
      );
      assert.ok(
        !/url\(\s*['"]?(?:\.\/)?fonts\//.test(doc),
        'unembedded url(fonts/…) reference in a math-free export'
      );
    });

    test('a feature-less export is under 10% of a full-feature export size', async () => {
      const engine = new MarkdownEngine({ ...BASE_CONFIG });
      const builder = new StandaloneHtmlBuilder(vscode.Uri.file(repoRoot));

      const { html: plainHtml } = engine.render(PLAIN_MD);
      const plain = await builder.buildForBrowser(plainHtml, 'plain', docUri);

      // A document using every renderer embeds the same payload an export at
      // the previous HEAD embedded unconditionally — the baseline the issue
      // measures against.
      const { html: fullHtml } = engine.render(MATH_MD + '\n' + MERMAID_MD + '\n' + EXCALIDRAW_MD);
      const full = await builder.buildForBrowser(fullHtml, 'full', docUri);

      console.log(
        `export sizes — plain: ${plain.length} B, full-feature: ${full.length} B ` +
          `(ratio ${(plain.length / full.length).toFixed(4)})`
      );
      assert.ok(
        plain.length * 10 < full.length,
        `plain export ${plain.length} B is not <10% of full-feature export ${full.length} B`
      );
    });

    test('a document with math still embeds every referenced font face', async () => {
      const engine = new MarkdownEngine({ ...BASE_CONFIG });
      const { html } = engine.render(MATH_MD);
      const builder = new StandaloneHtmlBuilder(vscode.Uri.file(repoRoot));
      const doc = await builder.buildForBrowser(html, 'math', docUri);

      assert.ok(doc.includes('katex-inline'), 'katex placeholder lost from export');
      assert.ok(
        !/url\(\s*['"]?(?:\.\/)?fonts\//.test(doc),
        'unembedded url(fonts/…) reference survived in math export'
      );
      const dataFontUrls = doc.match(/url\(data:font\/[^)]+\)/g) || [];
      assert.ok(dataFontUrls.length > 0, 'no url(data:font/…) embedded in math export');
    });

    test('class-name mentions in prose do not trigger embeds', async () => {
      const reads: string[] = [];
      const builder = new StandaloneHtmlBuilder(
        vscode.Uri.file(repoRoot),
        () => {},
        recordingReader(reads)
      );
      const doc = await builder.buildForBrowser(
        '<p>mermaid-block katex-inline katex-block excalidraw-block data-math</p>',
        'prose',
        docUri
      );

      assert.strictEqual(countDataFontUrls(doc), 0, 'prose mention triggered font embed');
      for (const p of reads) {
        assert.ok(!VENDOR_BUNDLE.test(p), `vendor bundle read on prose mention: ${p}`);
      }
    });
  });

  suite('real rendering (headless Chromium)', function () {
    this.timeout(90000);

    let tmpDir: string;
    setup(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdp-gating-'));
    });
    teardown(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('a document with mermaid renders its diagram in the PDF export path', async function () {
      if (!chromeAvailable()) {
        return this.skip();
      }
      const engine = new MarkdownEngine({ ...BASE_CONFIG });
      const { html } = engine.render(MERMAID_MD);
      const builder = new StandaloneHtmlBuilder(vscode.Uri.file(repoRoot));
      const browserHtml = await builder.buildForBrowser(html, 'diagram', docUri);

      // The browser-side render must produce real SVG — the same markup the
      // PDF page prints.
      const rendered = await renderInBrowser(browserHtml);
      assert.ok(rendered.includes('<svg'), 'mermaid diagram did not render to SVG');
      assert.ok(
        rendered.includes('mermaid-rendered'),
        'mermaid block was not processed in the export document'
      );

      const outputPath = path.join(tmpDir, 'diagram.pdf');
      await generatePdf(browserHtml, outputPath);
      const pdf = fs.readFileSync(outputPath);
      assert.ok(pdf.length > 0, 'PDF export of mermaid document is empty');
      assert.strictEqual(
        pdf.subarray(0, 5).toString('latin1'),
        '%PDF-',
        'mermaid document export is not a PDF'
      );
    });

    test('a document with math renders .katex markup with resolvable fonts', async function () {
      if (!chromeAvailable()) {
        return this.skip();
      }
      const engine = new MarkdownEngine({ ...BASE_CONFIG });
      const { html } = engine.render(MATH_MD);
      const builder = new StandaloneHtmlBuilder(vscode.Uri.file(repoRoot));
      const browserHtml = await builder.buildForBrowser(html, 'math', docUri);

      const rendered = await renderInBrowser(browserHtml);
      assert.ok(/class="katex"/.test(rendered), 'KaTeX did not render in the export document');
      assert.ok(countDataFontUrls(rendered) > 0, 'font faces missing from rendered math export');
      assert.ok(
        !/url\(\s*['"]?(?:\.\/)?fonts\//.test(rendered),
        'unembedded font reference in rendered math export'
      );
    });
  });
});
