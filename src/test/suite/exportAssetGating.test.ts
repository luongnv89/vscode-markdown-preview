import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { JSDOM, VirtualConsole } from 'jsdom';
import { MarkdownEngine } from '../../markdownEngine';
import { StandaloneHtmlBuilder } from '../../export/standaloneHtmlBuilder';
import { generatePdf, renderInBrowser } from '../../export/pdfExporter';
import { findChromePath } from '../../export/browserFinder';
import { PreviewConfig } from '../../types/messages';

// Export asset gating regression tests (issue #74): an export must embed only
// the vendor runtimes the rendered document actually uses. A document with no
// math embeds no KaTeX script, stylesheet or base64 fonts; a document with no
// mermaid/excalidraw blocks reads neither diagram bundle from disk. Mermaid
// fences render through pele (#156), so pele.min.js is the mermaid bundle.

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

const VENDOR_BUNDLE = /(?:^|[/\\])(katex\.min\.js|pele\.min\.js|excalidraw-utils\.min\.js)$/;
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

// The slice of a jsdom window the export render-script tests read and stub.
interface ExportElement {
  textContent: string | null;
  innerHTML: string;
  open?: boolean;
  classList: { contains(c: string): boolean };
  getAttribute(name: string): string | null;
  querySelector(sel: string): ExportElement | null;
}
interface ExportWindow {
  __exportRenderComplete?: boolean;
  pele?: unknown;
  ExcalidrawUtils?: unknown;
  document: { querySelector(sel: string): ExportElement | null };
}

// Run a buildForBrowser document in jsdom with its scripts live (jsdom
// ignores the CSP and nonces) and wait for the render script's completion
// flag — the same flag pdfExporter waits on. `setup` runs before parsing, so
// a stubbed renderer is in place when the inlined scripts execute.
async function runExportDocument(
  html: string,
  setup?: (window: ExportWindow) => void
): Promise<ExportWindow> {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    virtualConsole: new VirtualConsole(),
    beforeParse: (window) => setup?.(window as unknown as ExportWindow),
  });
  const window = dom.window as unknown as ExportWindow;
  const deadline = Date.now() + 10000;
  while (window.__exportRenderComplete !== true && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return window;
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

      for (const name of ['katex.min.js', 'pele.min.js', 'excalidraw-utils.min.js']) {
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

  suite('export render script (jsdom, #156)', function () {
    this.timeout(30000);
    // No dist/ here: every vendor read fails and embeds an empty script, so
    // a test controls the renderer through its beforeParse stub alone.
    const bare = new StandaloneHtmlBuilder(vscode.Uri.file('/nonexistent-extension-dir'));
    const MERMAID_DOC = new MarkdownEngine({ ...BASE_CONFIG }).render(MERMAID_MD).html;

    test('without pele the export still signals completion and keeps the source', async () => {
      const html = await bare.buildForBrowser(MERMAID_DOC, 'no-pele', docUri);
      const window = await runExportDocument(html);
      assert.strictEqual(window.__exportRenderComplete, true, 'export never signalled completion');
      const block = window.document.querySelector('.mermaid-block')!;
      assert.strictEqual(block.getAttribute('data-processed'), 'false');
      assert.ok(block.querySelector('pre.mermaid'), 'source <pre> lost without a renderer');
    });

    test('pele is called with links disabled and an export id prefix', async () => {
      const calls: Array<{ code: string; opts: { idPrefix?: string; links?: boolean } }> = [];
      const html = await bare.buildForBrowser(MERMAID_DOC, 'stub', docUri);
      const window = await runExportDocument(html, (w) => {
        w.pele = {
          render(code: string, opts: { idPrefix?: string; links?: boolean }) {
            calls.push({ code, opts });
            return { svg: '<svg class="stub-svg"></svg>' };
          },
        };
      });
      assert.strictEqual(window.__exportRenderComplete, true);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].opts.links, false, 'export rendered without links: false');
      assert.strictEqual(calls[0].opts.idPrefix, 'mermaid-export-0-');
      const block = window.document.querySelector('.mermaid-block')!;
      assert.ok(block.classList.contains('mermaid-rendered'), 'block not marked rendered');
      assert.ok(block.querySelector('svg.stub-svg'), 'rendered svg not injected');
    });

    test('a non-PeleError throw yields a readable, textContent-only error', async () => {
      const html = await bare.buildForBrowser(MERMAID_DOC, 'string-throw', docUri);
      const window = await runExportDocument(html, (w) => {
        w.pele = {
          render() {
            throw '<b>bold</b> plain string failure';
          },
        };
      });
      assert.strictEqual(window.__exportRenderComplete, true);
      const error = window.document.querySelector('.mermaid-error')!;
      assert.ok(error, 'no readable error block');
      assert.ok(error.querySelector('.mermaid-error-lead'), 'error lead missing');
      const raw = error.querySelector('details.mermaid-error-details .mermaid-error-raw')!;
      assert.strictEqual(raw.textContent, '<b>bold</b> plain string failure');
      assert.strictEqual(error.querySelector('b'), null, 'thrown text was parsed as markup');
    });

    test('a hostile error message renders as text with the document-line lead', async () => {
      const html = await bare.buildForBrowser(MERMAID_DOC, 'hostile', docUri);
      const window = await runExportDocument(html, (w) => {
        w.pele = {
          render() {
            throw new Error('<img src=x onerror=alert(1)><script>alert(2)</script>');
          },
        };
      });
      assert.strictEqual(window.__exportRenderComplete, true);
      const error = window.document.querySelector('.mermaid-error')!;
      assert.ok(error, 'no readable error block');
      assert.strictEqual(error.querySelector('img'), null, 'error message injected an <img>');
      assert.strictEqual(error.querySelector('script'), null, 'error message injected a <script>');
      assert.ok(
        error.querySelector('.mermaid-error-lead')!.textContent!.includes('document line 1'),
        `lead does not name the fence line: ${error.textContent}`
      );
      assert.strictEqual(
        error.querySelector('.mermaid-error-raw')!.textContent,
        '<img src=x onerror=alert(1)><script>alert(2)</script>'
      );
    });

    test('a throw that escapes every block handler still signals completion', async () => {
      const doc = new MarkdownEngine({ ...BASE_CONFIG }).render(EXCALIDRAW_MD).html;
      const html = await bare.buildForBrowser(doc, 'escaping-throw', docUri);
      const window = await runExportDocument(html, (w) => {
        // A rejection with no .message breaks the per-block error handler
        // itself; only the script-wide finally can still release pdfExporter.
        w.ExcalidrawUtils = {
          exportToSvg: () => Promise.reject(null),
        };
      });
      assert.strictEqual(window.__exportRenderComplete, true, 'render script stalled the export');
    });

    test('real pele shows a syntax error in place, with the raw message open', async () => {
      const broken = new MarkdownEngine({ ...BASE_CONFIG }).render(
        '# Broken\n\n```mermaid\nflowchart LR\n  A -->\n```\n'
      ).html;
      const builder = new StandaloneHtmlBuilder(vscode.Uri.file(repoRoot));
      const html = await builder.buildForBrowser(broken, 'syntax', docUri);
      const window = await runExportDocument(html);
      assert.strictEqual(window.__exportRenderComplete, true);
      assert.ok(window.pele, 'pele.min.js was not inlined into the export');
      const error = window.document.querySelector('.mermaid-error')!;
      assert.ok(error, 'syntax error did not produce a readable error block');
      assert.ok(
        error.querySelector('.mermaid-error-lead')!.textContent!.includes('document line 3'),
        `lead does not name the fence line: ${error.textContent}`
      );
      const details = error.querySelector('details.mermaid-error-details')!;
      assert.strictEqual(details.open, true, 'raw message is collapsed in the export');
      assert.match(details.textContent || '', /Parse error/);
      assert.ok(window.document.querySelector('h1'), 'rest of the document did not render');
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
