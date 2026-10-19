import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

// Landing page build tests (issues #71 and #78). The generator runs once per
// suite through the compiled dist/markdownCore.js shared engine (pretest has
// already built it), emitting docs/index.html plus the docs/assets/ files the
// page now links instead of inlining vendor runtimes. Mermaid fences render
// through pele (#156), so pele.min.js is the diagram runtime the page links.

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const docsDir = path.join(repoRoot, 'docs');
const indexPath = path.join(docsDir, 'index.html');
const assetsDir = path.join(docsDir, 'assets');
const scriptPath = path.join(repoRoot, 'scripts', 'generate-landing.cjs');
const MAX_INDEX_BYTES = 2_000_000;
const MAX_INLINE_SCRIPT_BYTES = 10_000;

interface VendorAssetPlan {
  scripts: string[];
  styles: string[];
  dirs: string[];
}

interface LandingGenerator {
  generateLanding: () => Promise<void>;
  planVendorAssets: (needs: {
    math: boolean;
    mermaid: boolean;
    excalidraw: boolean;
  }) => VendorAssetPlan;
  LANDING_SCRIPT: string;
}

// The slice of a jsdom window the landing-script tests read and stub.
interface LandingElement {
  textContent: string | null;
  innerHTML: string;
  classList: { contains(c: string): boolean };
  getAttribute(name: string): string | null;
  querySelector(sel: string): LandingElement | null;
  click(): void;
}
interface LandingWindow {
  pele?: unknown;
  eval(code: string): unknown;
  document: {
    body: LandingElement;
    querySelector(sel: string): LandingElement | null;
  };
}

interface PeleCall {
  code: string;
  opts: { idPrefix?: string; links?: boolean };
}

// Run assets/landing.js against one diagram block in jsdom, with `pele`
// stubbed by `render` — the vendor script the page loads ahead of it.
function runLandingScript(
  render: (code: string, opts: PeleCall['opts']) => { svg: string }
): LandingWindow {
  const dom = new JSDOM(
    '<!doctype html><html><body class="preview-theme-dark"><div id="preview-content">' +
      '<div class="mermaid-block" data-processed="false" data-line="4">' +
      '<pre class="mermaid">graph TD; A--&gt;B</pre></div></div></body></html>',
    { runScripts: 'outside-only', url: 'https://landing.test/' }
  );
  const window = dom.window as unknown as LandingWindow;
  window.pele = { render };
  window.eval(generator().LANDING_SCRIPT);
  return window;
}

function generator(): LandingGenerator {
  return require(scriptPath) as LandingGenerator;
}

function scriptTags(html: string): string[] {
  return html.match(/<script\b[^>]*>/g) || [];
}

// Sum of every <script> element's inline body — the acceptance ceiling counts
// the JSON-LD data block too, so nothing is filtered by type.
function inlineScriptBytes(html: string): number {
  let total = 0;
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    total += match[1].length;
  }
  return total;
}

suite('landing page build (#71, #78)', function () {
  this.timeout(60_000);

  let html = '';
  let pkgVersion = '';

  suiteSetup(async () => {
    await generator().generateLanding();
    html = fs.readFileSync(indexPath, 'utf8');
    pkgVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
      .version as string;
  });

  suite('version and ordering (#71)', () => {
    test('JSON-LD softwareVersion equals package.json version', () => {
      const ld = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(html);
      assert.ok(ld, 'JSON-LD data block missing from generated page');
      const data = JSON.parse(ld[1]) as { softwareVersion?: string };
      // Equality against the package, never a hardcoded literal — the test
      // keeps passing when package.json is bumped.
      assert.strictEqual(data.softwareVersion, pkgVersion);
      assert.ok(
        html.includes(`"softwareVersion":"${pkgVersion}"`),
        `expected compact "softwareVersion":"${pkgVersion}" in generated page`
      );
    });

    test('landing.md frontmatter carries no hardcoded version', () => {
      const source = fs.readFileSync(path.join(docsDir, 'landing.md'), 'utf8');
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
      assert.ok(frontmatter, 'landing.md has no frontmatter block');
      assert.ok(
        !/^version\s*:/m.test(frontmatter[1]),
        'landing.md frontmatter still declares a hardcoded version'
      );
    });

    test('the self-generation note no longer precedes the screenshot', () => {
      const noteIdx = html.indexOf('This page is the exact output');
      const shotIdx = html.indexOf('Markdown Preview Pro screenshot');
      const showcaseIdx = html.indexOf('Rendering showcase');
      assert.ok(noteIdx > -1, 'self-generation note missing from generated page');
      assert.ok(shotIdx > -1, 'screenshot image missing from generated page');
      assert.ok(showcaseIdx > -1, 'rendering showcase heading missing');
      assert.ok(noteIdx > shotIdx, 'note still appears before the screenshot');
      assert.ok(noteIdx > showcaseIdx, 'note is not beside the rendering showcase');
    });
  });

  suite('external vendor assets (#78)', () => {
    test('index.html is under the 2,000,000-byte ceiling', () => {
      const size = fs.statSync(indexPath).size;
      assert.ok(
        size < MAX_INDEX_BYTES,
        `docs/index.html is ${size} B — ceiling is ${MAX_INDEX_BYTES} B`
      );
    });

    test('every <script> element carries a src attribute', () => {
      const tags = scriptTags(html);
      assert.ok(tags.length > 0, 'no <script> elements found');
      for (const tag of tags) {
        assert.ok(/\bsrc\s*=/.test(tag), `<script> without src: ${tag.slice(0, 80)}`);
      }
    });

    test('total inline script text is under 10,000 B', () => {
      const inline = inlineScriptBytes(html);
      assert.ok(
        inline < MAX_INLINE_SCRIPT_BYTES,
        `inline script text is ${inline} B — ceiling is ${MAX_INLINE_SCRIPT_BYTES} B`
      );
    });

    test('every linked asset resolves to an emitted file', () => {
      const refs = [
        ...[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]),
        ...[...html.matchAll(/<link\b[^>]*\bhref="(assets\/[^"]+)"/g)].map((m) => m[1]),
      ];
      assert.ok(refs.length > 0, 'no asset references found');
      for (const ref of refs) {
        assert.ok(
          fs.existsSync(path.join(docsDir, ref)),
          `referenced asset was not emitted: ${ref}`
        );
      }
    });

    test('the demo document emits katex and pele (mermaid) as separate files', () => {
      for (const file of [
        'landing.js',
        'ld.json',
        'katex.min.js',
        'katex.min.css',
        'pele.min.js',
      ]) {
        assert.ok(fs.existsSync(path.join(assetsDir, file)), `docs/assets/${file} was not emitted`);
        assert.ok(html.includes(`assets/${file}`), `page does not reference assets/${file}`);
      }
      const fontsDir = path.join(assetsDir, 'fonts');
      assert.ok(fs.statSync(fontsDir).isDirectory(), 'KaTeX fonts directory was not emitted');
      assert.ok(fs.readdirSync(fontsDir).length > 0, 'KaTeX fonts directory is empty');
    });

    test('the asset plan drops mermaid when the page has no diagrams', () => {
      const plan = generator().planVendorAssets({ math: true, mermaid: false, excalidraw: false });
      assert.deepStrictEqual(plan.scripts, ['katex.min.js']);
    });

    test('the asset plan drops katex assets when the page has no math', () => {
      const plan = generator().planVendorAssets({ math: false, mermaid: true, excalidraw: false });
      assert.deepStrictEqual(plan.scripts, ['pele.min.js']);
      assert.deepStrictEqual(plan.styles, []);
      assert.deepStrictEqual(plan.dirs, []);
    });

    test('a page with neither math nor diagrams links no vendor asset', () => {
      const plan = generator().planVendorAssets({ math: false, mermaid: false, excalidraw: false });
      assert.deepStrictEqual(plan, { scripts: [], styles: [], dirs: [] });
    });
  });

  suite('diagram rendering through pele (#156)', () => {
    test('landing.js renders each block once with links disabled', () => {
      const calls: PeleCall[] = [];
      const window = runLandingScript((code, opts) => {
        calls.push({ code, opts });
        return { svg: '<svg class="stub-svg"></svg>' };
      });
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].code, 'graph TD; A-->B');
      assert.strictEqual(calls[0].opts.links, false, 'landing rendered without links: false');
      assert.strictEqual(calls[0].opts.idPrefix, 'mermaid-landing-0-');
      const block = window.document.querySelector('.mermaid-block')!;
      assert.ok(block.classList.contains('mermaid-rendered'), 'block not marked rendered');
      assert.strictEqual(block.getAttribute('data-processed'), 'true');
      assert.ok(block.querySelector('svg.stub-svg'), 'rendered svg not injected');
    });

    test('the theme toggle recolours through CSS without re-rendering diagrams', () => {
      const calls: PeleCall[] = [];
      const window = runLandingScript((code, opts) => {
        calls.push({ code, opts });
        return { svg: '<svg class="stub-svg"></svg>' };
      });
      const svg = window.document.querySelector('.mermaid-block svg');
      const wasDark = window.document.body.classList.contains('preview-theme-dark');
      window.document.querySelector('.preview-toolbar .toolbar-button')!.click();
      assert.notStrictEqual(
        window.document.body.classList.contains('preview-theme-dark'),
        wasDark,
        'toolbar click did not switch the theme'
      );
      assert.strictEqual(calls.length, 1, 'theme toggle re-rendered the diagram');
      assert.strictEqual(window.document.querySelector('.mermaid-block svg'), svg);
    });

    test('a render error is shown as readable text, never as markup', () => {
      const window = runLandingScript(() => {
        throw new Error('<img src=x onerror=alert(1)><script>alert(2)</script>');
      });
      const error = window.document.querySelector('.mermaid-error')!;
      assert.ok(error, 'no readable error block');
      assert.ok(error.querySelector('.mermaid-error-lead'), 'error lead missing');
      assert.strictEqual(error.querySelector('img'), null, 'error message injected an <img>');
      assert.strictEqual(error.querySelector('script'), null, 'error message injected a <script>');
      assert.strictEqual(
        error.querySelector('details.mermaid-error-details .mermaid-error-raw')!.textContent,
        '<img src=x onerror=alert(1)><script>alert(2)</script>'
      );
    });
  });

  test('generated page is complete rendered output', () => {
    assert.ok(html.trimEnd().endsWith('</html>'), 'page does not end with </html>');
    assert.ok(html.includes('<h1'), 'page has no <h1>');
    assert.ok(/class="[^"]*\bcode-line\b/.test(html), 'code-line spans missing');
  });
});
