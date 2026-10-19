import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { JSDOM } from 'jsdom';

// pele rendering tests (issue #156): Mermaid fences render through pele, a
// Mermaid-syntax renderer whose global bundle ships as
// dist/webview/vendor/pele.min.js. These run in Node, with no browser:
// - AC2: every diagram that rendered under Mermaid still renders. The
//   frozen fixture src/test/fixtures/pele-ac2-fixture.json covers every
//   header spelling Mermaid 12.1.0 accepted, the repo's own mermaid fences
//   and one example per pele diagram type. Each source was validated with
//   Mermaid 12.1.0's mermaid.parse before mermaid was removed. The examples
//   come from pele.run, the docs site of the MIT-licensed pele project.
// - AC5: invalid syntax throws a PeleError carrying a readable message.
// - Security: no rendered SVG carries script, handler or navigation markup.
//   src/test/fixtures/pele-hostile-fixture.json holds the hostile inputs.
//   `links: false`, the option every call site passes, is shown to matter.
// - AC3 (static): every colour pele reads is declared in
//   webview/styles/mermaid.css, with dark-theme overrides, and the light
//   series/status tones reach 4.5:1 against white.

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const PELE_BUNDLE = path.join(repoRoot, 'dist', 'webview', 'vendor', 'pele.min.js');
const FIXTURES = path.join(repoRoot, 'src', 'test', 'fixtures');

interface PeleResult {
  svg: string;
  width: number;
  height: number;
  type: string;
}
interface PeleErrorShape extends Error {
  code: string;
  line: number;
  column: number;
}
interface PeleApi {
  render(source: string, options?: Record<string, unknown>): PeleResult;
  PeleError: new (message: string) => PeleErrorShape;
}

interface Ac2Entry {
  name: string;
  type: string;
  labels: string[];
  labelPrefix?: string;
  source: string;
}

// Loaded through vm, not imported: pele's package entry is ESM, and what
// ships is the IIFE that defines `var pele`. Wrapping it in a function body
// hands that local back without touching the Node global scope.
let peleApi: PeleApi | undefined;
function loadPele(): PeleApi {
  if (!peleApi) {
    const src = fs.readFileSync(PELE_BUNDLE, 'utf8');
    peleApi = vm.runInThisContext(`(function(){${src}\nreturn pele;})`, {
      filename: PELE_BUNDLE,
    })() as PeleApi;
  }
  return peleApi;
}

function readFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as T;
}

interface SvgElement {
  localName: string;
  textContent: string | null;
  attributes: ArrayLike<{ name: string; localName: string; value: string }>;
}
interface SvgDocument {
  querySelectorAll(sel: string): ArrayLike<SvgElement>;
  getElementsByTagName(tag: string): ArrayLike<SvgElement>;
}

function parseSvg(svg: string): SvgDocument {
  return new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document as unknown as SvgDocument;
}

// The webview's diagram font stack (MERMAID_FONT_FAMILY in renderer.ts).
const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// Options matching the webview call site — the id prefix shape mirrors
// `mermaid-${hash}-` from renderer.ts.
const PREVIEW_OPTIONS = { idPrefix: 'mermaid-t156-', fontFamily: FONT_FAMILY, links: false };

const FORBIDDEN_ELEMENTS = new Set(['script', 'iframe', 'foreignobject', 'a', 'object', 'embed']);

// Every finding that would make the SVG unsafe to innerHTML into the preview:
// an active or embedding element, an on* handler attribute, or any URL attribute
// other than an http(s) <image href>.
function securityFindings(svg: string): string[] {
  const doc = parseSvg(svg);
  const findings: string[] = [];
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (FORBIDDEN_ELEMENTS.has(el.localName.toLowerCase())) {
      findings.push(`<${el.localName}> element`);
    }
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.localName)) {
        findings.push(`${attr.name} handler on <${el.localName}>`);
      }
      if (/^(href|src)$/i.test(attr.localName)) {
        if (el.localName !== 'image' || !/^https?:\/\//i.test(attr.value)) {
          findings.push(`${attr.name}="${attr.value}" on <${el.localName}>`);
        }
      }
    }
  }
  return findings;
}

function hrefValues(svg: string): string[] {
  const doc = parseSvg(svg);
  const values: string[] = [];
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.localName === 'href') {
        values.push(`<${el.localName}> ${attr.value}`);
      }
    }
  }
  return values;
}

function textsOf(svg: string): string[] {
  return Array.from(parseSvg(svg).querySelectorAll('text, tspan')).map((n) =>
    (n.textContent || '').trim()
  );
}

suite('pele diagram rendering (#156)', () => {
  suite('AC2: every Mermaid-accepted diagram still renders', () => {
    const entries = readFixture<Ac2Entry[]>('pele-ac2-fixture.json');

    test('the frozen fixture covers all 33 pele diagram types', () => {
      assert.strictEqual(entries.length, 79);
      assert.strictEqual(new Set(entries.map((e) => e.type)).size, 33);
    });

    for (const entry of entries) {
      test(`${entry.name} renders as ${entry.type} with its labels`, () => {
        const result = loadPele().render(entry.source, PREVIEW_OPTIONS);
        assert.ok(/^<svg[\s>]/.test(result.svg), `no <svg> root for ${entry.name}`);
        assert.strictEqual(result.type, entry.type, `wrong diagram type for ${entry.name}`);
        const texts = textsOf(result.svg);
        for (const label of entry.labels) {
          assert.ok(
            texts.includes(label),
            `label ${JSON.stringify(label)} missing from ${entry.name}: ${JSON.stringify(texts)}`
          );
        }
        if (entry.labelPrefix) {
          const prefix = entry.labelPrefix;
          assert.ok(
            texts.some((t) => t.startsWith(prefix)),
            `no text starting with ${JSON.stringify(prefix)} in ${entry.name}`
          );
        }
      });
    }
  });

  suite('AC5: invalid syntax raises a readable PeleError', () => {
    test('a broken flowchart throws a syntax PeleError with a message', () => {
      const pele = loadPele();
      let caught: unknown;
      try {
        pele.render('flowchart LR\n A -->', PREVIEW_OPTIONS);
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof Error, `expected an Error, got ${String(caught)}`);
      assert.ok(caught instanceof pele.PeleError, 'not a PeleError');
      const err = caught as PeleErrorShape;
      assert.strictEqual(err.code, 'syntax');
      assert.ok(err.message.trim().length > 0, 'empty error message');
    });

    test('an unknown diagram header throws an unsupported-diagram PeleError', () => {
      assert.throws(
        () => loadPele().render('not a diagram at all', PREVIEW_OPTIONS),
        (err: PeleErrorShape) => err.code === 'unsupported-diagram' && err.message.length > 0
      );
    });
  });

  suite('security: rendered SVG is inert', () => {
    const hostile = readFixture<Record<string, string>>('pele-hostile-fixture.json');

    for (const [name, source] of Object.entries(hostile)) {
      test(`hostile ${name} renders with no active markup`, () => {
        const { svg } = loadPele().render(source, PREVIEW_OPTIONS);
        assert.deepStrictEqual(securityFindings(svg), [], `unsafe markup in ${name}`);
      });
    }

    test('every AC2 diagram rendered with links: false carries no active markup', () => {
      for (const entry of readFixture<Ac2Entry[]>('pele-ac2-fixture.json')) {
        const { svg } = loadPele().render(entry.source, { links: false });
        assert.deepStrictEqual(securityFindings(svg), [], `unsafe markup in ${entry.name}`);
      }
    });

    test('image shapes keep http(s) sources and drop javascript:, data: and file:', () => {
      const pele = loadPele();
      assert.deepStrictEqual(hrefValues(pele.render(hostile.imageHttps, PREVIEW_OPTIONS).svg), [
        '<image> https://example.com/x.png',
      ]);
      for (const name of ['imageJavascript', 'imageData', 'imageFile']) {
        assert.deepStrictEqual(
          hrefValues(pele.render(hostile[name], PREVIEW_OPTIONS).svg),
          [],
          `${name} emitted an href`
        );
      }
    });

    test('links: false is load-bearing — pele links a click href by default', () => {
      const pele = loadPele();
      const source = 'flowchart LR\n A --> B\n click B href "https://example.com"';
      assert.deepStrictEqual(hrefValues(pele.render(source).svg), ['<a> https://example.com/']);
      assert.deepStrictEqual(hrefValues(pele.render(source, { links: false }).svg), []);
    });
  });

  suite('AC3 (static): every pele colour is themed by mermaid.css', () => {
    const COLOUR_VARS = [
      'accent',
      'bg',
      'border',
      'critical',
      'error',
      'fg',
      'line',
      'muted',
      'surface',
      'surface-alt',
    ];
    const SERIES_VARS = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `series-${i}`);
    const NON_COLOUR = /^(font|font-mono|radius|zoom-.*)$/;
    const DARK_SELECTORS = [
      'body.preview-theme-dark .mermaid-block',
      'body.vscode-dark:not(.preview-theme-light) .mermaid-block',
      'body.vscode-high-contrast:not(.vscode-high-contrast-light):not(.preview-theme-light) .mermaid-block',
    ];

    // Flat rule list: comment-stripped, selectors split and whitespace-
    // normalized, declarations as a name → value map.
    function cssRules(css: string): Array<{ selectors: string[]; decls: Map<string, string> }> {
      const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
      const rules: Array<{ selectors: string[]; decls: Map<string, string> }> = [];
      for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = m[1].split(',').map((s) => s.replace(/\s+/g, ' ').trim());
        const decls = new Map<string, string>();
        for (const part of m[2].split(';')) {
          const idx = part.indexOf(':');
          if (idx > 0) {
            decls.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
          }
        }
        rules.push({ selectors, decls });
      }
      return rules;
    }

    const css = fs.readFileSync(path.join(repoRoot, 'webview', 'styles', 'mermaid.css'), 'utf8');
    const rules = cssRules(css);
    const baseRule = rules.find(
      (r) => r.selectors.length === 1 && r.selectors[0] === '.mermaid-block'
    );

    test('the pele bundle reads no colour variable outside the themed set', () => {
      const src = fs.readFileSync(PELE_BUNDLE, 'utf8');
      const read = new Set<string>();
      for (const m of src.matchAll(/var\(--pele-([a-z][a-z0-9-]*?)\s*[,)]/g)) {
        if (!NON_COLOUR.test(m[1])) {
          read.add(m[1]);
        }
      }
      assert.ok(read.size > 0, 'no --pele-* colour reads found — bundle changed shape?');
      const unknown = [...read].filter((name) => !COLOUR_VARS.includes(name));
      assert.deepStrictEqual(unknown, [], 'pele reads colours mermaid.css does not theme');
      // Series colours are built from a template literal the scan cannot see.
      assert.ok(src.includes('--pele-series-${'), 'series colour template not found');
    });

    test('the base .mermaid-block rule declares every colour, series and font var', () => {
      assert.ok(baseRule, 'no standalone .mermaid-block rule in mermaid.css');
      for (const name of [...COLOUR_VARS, ...SERIES_VARS, 'font', 'font-mono']) {
        assert.ok(baseRule!.decls.has(`--pele-${name}`), `--pele-${name} not declared`);
      }
    });

    test('derived tones never use the translucent theme tokens', () => {
      for (const name of ['line', 'border', 'surface', 'surface-alt', 'muted']) {
        const value = baseRule!.decls.get(`--pele-${name}`) || '';
        assert.ok(
          !/--fg-muted|--code-bg|--panel-bg|--border-color|rgba\(/.test(value),
          `--pele-${name} uses a translucent token: ${value}`
        );
      }
    });

    test('light series and status tones reach 4.5:1 against white (WCAG 1.4.3)', () => {
      // pele draws labels in --pele-bg on series/critical fills and error
      // text in --pele-error; the light palette is also what exports use.
      const luminance = (hex: string): number => {
        const [r, g, b] = [1, 3, 5].map((i) => {
          const c = parseInt(hex.slice(i, i + 2), 16) / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const white = luminance('#ffffff');
      for (const name of [...SERIES_VARS, 'critical', 'error']) {
        const value = baseRule!.decls.get(`--pele-${name}`) || '';
        assert.ok(/^#[0-9a-f]{6}$/i.test(value), `--pele-${name} is not a #rrggbb hex: ${value}`);
        const ratio = (white + 0.05) / (luminance(value) + 0.05);
        assert.ok(ratio >= 4.5, `--pele-${name} ${value} is only ${ratio.toFixed(2)}:1 on white`);
      }
    });

    test('each dark selector overrides the series and status colours', () => {
      for (const selector of DARK_SELECTORS) {
        const rule = rules.find((r) => r.selectors.includes(selector));
        assert.ok(rule, `no rule for ${selector}`);
        for (const name of [...SERIES_VARS, 'critical', 'error']) {
          const value = rule!.decls.get(`--pele-${name}`);
          assert.ok(value, `${selector} does not override --pele-${name}`);
          assert.notStrictEqual(
            value,
            baseRule!.decls.get(`--pele-${name}`),
            `${selector} repeats the light --pele-${name}`
          );
        }
      }
    });

    test('--pele-font is exactly the font stack pele measures with', () => {
      const renderer = fs.readFileSync(path.join(repoRoot, 'webview', 'renderer.ts'), 'utf8');
      const match = renderer.match(/const MERMAID_FONT_FAMILY =\s*"([^"]+)"/);
      assert.ok(match, 'MERMAID_FONT_FAMILY not found in renderer.ts');
      assert.strictEqual(match![1], FONT_FAMILY);
      assert.strictEqual(baseRule!.decls.get('--pele-font'), FONT_FAMILY);
    });

    test('the bundled main.css carries the pele theming used by exports and the landing page', () => {
      const mainCss = fs.readFileSync(path.join(repoRoot, 'dist', 'webview', 'main.css'), 'utf8');
      for (const name of [...COLOUR_VARS, ...SERIES_VARS]) {
        assert.ok(mainCss.includes(`--pele-${name}:`), `main.css lacks --pele-${name}`);
      }
    });
  });
});
