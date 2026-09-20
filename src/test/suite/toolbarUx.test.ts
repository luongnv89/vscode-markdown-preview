import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as esbuild from 'esbuild';
import { JSDOM } from 'jsdom';

// Toolbar UX regression tests (#66, #67, #69):
// - #66: the toolbar must be visible at rest (opacity >= 0.85, effective
//   contrast >= 4.5:1), keyboard-focusable (:focus-visible ring), and the
//   export commands reachable from the preview context menu.
// - #67: buttons need labels (persistent on the two export actions, hover
//   tooltips on icon-only buttons), >= 32px targets, >= 6px gap, and a
//   separator ahead of the export group.
// - #69: the manual theme choice persists through vscode.setState and the
//   TOC button must not claim an "active" state the UI cannot show (the
//   sidebar is an overlay drawer under 500px, never display:none).
//
// The webview layer cannot be imported directly (tsconfig.test is rooted at
// src/), so each module is transpiled on the fly and evaluated against jsdom —
// the same DOM the webview actually runs in.

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const webviewDir = path.join(repoRoot, 'webview');

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

// Minimal structural DOM surface the toolbar modules touch — the test project
// compiles without the DOM lib, so jsdom is typed through these interfaces.
interface TestClassList {
  add(c: string): void;
  remove(c: string): void;
  toggle(c: string, force?: boolean): boolean;
  contains(c: string): boolean;
}
interface TestElement {
  className: string;
  title: string;
  textContent: string | null;
  innerHTML: string;
  disabled: boolean;
  dataset: Record<string, string | undefined>;
  classList: TestClassList;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  appendChild<T>(node: T): T;
  remove(): void;
  addEventListener(type: string, cb: (e: unknown) => void): void;
  click(): void;
  children: ArrayLike<TestElement>;
  previousElementSibling: TestElement | null;
  querySelector(sel: string): TestElement | null;
  querySelectorAll(sel: string): ArrayLike<TestElement>;
}
interface TestDocument {
  body: TestElement;
  createElement(tag: string): TestElement;
  createTextNode(text: string): unknown;
  getElementById(id: string): TestElement | null;
  querySelector(sel: string): TestElement | null;
  querySelectorAll(sel: string): ArrayLike<TestElement>;
  addEventListener(type: string, cb: (e: unknown) => void): void;
}

interface ToolbarModule {
  initToolbar(vscode: unknown): void;
}
interface TocModule {
  initToc(): void;
  setTocToggleButton(button: TestElement): void;
  toggleToc(): void;
}
interface DomUtilsModule {
  createButton(icon: string, title: string, onClick: () => void, label?: string): TestElement;
}

interface FakeVscodeState {
  scrollPosition?: number;
  theme?: 'light' | 'dark';
}
interface FakeVscode {
  posted: Array<{ type: string }>;
  state: FakeVscodeState | undefined;
  postMessage(msg: { type: string }): void;
  getState(): FakeVscodeState | undefined;
  setState(next: FakeVscodeState): void;
}

function fakeVscode(initial?: FakeVscodeState): FakeVscode {
  const fake: FakeVscode = {
    posted: [],
    state: initial,
    postMessage(msg) {
      fake.posted.push(msg);
    },
    getState() {
      return fake.state;
    },
    setState(next) {
      fake.state = next;
    },
  };
  return fake;
}

function makeDocument(): TestDocument {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  return dom.window.document as unknown as TestDocument;
}

// A tiny CommonJS loader: transpile each webview/*.ts with the bundled
// esbuild and evaluate it with the jsdom globals the webview runs under.
// The webview layer only has relative './x' imports, so the resolver is a
// path join.
function loadWebviewModule<T>(entry: string, document: TestDocument): T {
  const cache = new Map<string, { exports: unknown }>();
  const load = (absNoExt: string): unknown => {
    const abs = absNoExt.endsWith('.ts') ? absNoExt : `${absNoExt}.ts`;
    const cached = cache.get(abs);
    if (cached) {
      return cached.exports;
    }
    const source = fs.readFileSync(abs, 'utf8');
    const { code } = esbuild.transformSync(source, {
      loader: 'ts',
      format: 'cjs',
      target: 'es2020',
    });
    // esbuild's cjs output reassigns module.exports wholesale, so cache the
    // module object and read .exports at require time (same as Node).
    const module = { exports: {} as Record<string, unknown> };
    cache.set(abs, module);
    const localRequire = (spec: string): unknown => {
      if (!spec.startsWith('.')) {
        throw new Error(`unexpected bare import in webview module: ${spec}`);
      }
      return load(path.resolve(path.dirname(abs), spec));
    };
    const fn = new Function(
      'module',
      'exports',
      'require',
      'document',
      'window',
      'IntersectionObserver',
      'MutationObserver',
      code
    );
    fn(module, module.exports, localRequire, document, undefined, undefined, undefined);
    return module.exports;
  };
  return load(path.join(webviewDir, entry)) as T;
}

// --- CSS helpers -----------------------------------------------------------

function cssBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match![1];
}

// Lookbehind keeps `width:` from matching inside `min-width:`.
function decl(block: string, prop: string): string {
  const match = block.match(new RegExp(`(?<![-\\w])${prop}:\\s*([^;]+);`));
  assert.ok(match, `missing declaration ${prop}`);
  return match![1].trim();
}

// Extract the inner body of `@media (max-width: 500px) { ... }` by brace
// counting — nested rules defeat a flat regex.
function mediaQueryBody(css: string, query: string): string {
  const start = css.indexOf(query);
  assert.ok(start >= 0, `media query not found: ${query}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') {
      depth++;
    } else if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        return css.slice(open + 1, i);
      }
    }
  }
  assert.fail('unclosed media query block');
}

// --- WCAG contrast helpers -------------------------------------------------

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const v = hex.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(fg: Rgb, bg: Rgb): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// The toolbar renders at `opacity`; the composited icon colour is the token
// blended over the surface behind it (the page, which uses --bg-primary).
function blend(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ];
}

// --- Suite -----------------------------------------------------------------

suite('preview toolbar UX (#66, #67, #69)', () => {
  suite('visibility and focus (#66)', () => {
    test('resting opacity is >= 0.85 with no 0.4 remnant, and buttons are keyboard-focusable', () => {
      const css = readRepoFile('webview/styles/toolbar.css');
      assert.ok(!/opacity:\s*0\.4\b/.test(css), 'opacity: 0.4 still present');
      const toolbarBlock = cssBlock(css, '.preview-toolbar');
      const opacity = parseFloat(decl(toolbarBlock, 'opacity'));
      assert.ok(opacity >= 0.85, `resting opacity ${opacity} < 0.85`);
      assert.ok(
        /\.toolbar-button:focus-visible\s*\{[^}]*outline\s*:/.test(css),
        'no :focus-visible outline on .toolbar-button'
      );
      assert.ok(
        /\.preview-toolbar:focus-within/.test(css),
        'toolbar does not brighten on keyboard focus (focus-within)'
      );
    });

    test('muted foreground keeps >= 4.5:1 contrast at resting opacity in both themes', () => {
      const css = readRepoFile('webview/styles/toolbar.css');
      const opacity = parseFloat(decl(cssBlock(css, '.preview-toolbar'), 'opacity'));
      for (const theme of ['light', 'dark']) {
        const block = cssBlock(css, `body.preview-theme-${theme}`);
        const fg = hexToRgb(decl(block, '--fg-muted'));
        const bg = hexToRgb(decl(block, '--bg-primary'));
        const raw = contrastRatio(fg, bg);
        const composited = contrastRatio(blend(fg, bg, opacity), bg);
        assert.ok(raw >= 4.5, `${theme}: raw contrast ${raw.toFixed(2)} < 4.5:1`);
        assert.ok(
          composited >= 4.5,
          `${theme}: composited contrast at opacity ${opacity} is ${composited.toFixed(2)} < 4.5:1`
        );
      }
    });

    test('export commands are contributed to the preview webview context menu', () => {
      const pkg = JSON.parse(readRepoFile('package.json')) as {
        contributes: { menus: Record<string, Array<{ command: string; when?: string }>> };
      };
      const webviewMenus = pkg.contributes.menus['webview/context'] || [];
      for (const command of ['markdownPreviewPro.exportToHtml', 'markdownPreviewPro.exportToPdf']) {
        assert.ok(
          webviewMenus.some(
            (m) =>
              m.command === command && (m.when || '').includes("webviewId == 'markdownPreviewPro'")
          ),
          `${command} missing from webview/context menu contributions`
        );
      }
    });
  });

  suite('labels and target size (#67)', () => {
    test('buttons are >= 32px in both dimensions and the gap is >= 6px', () => {
      const css = readRepoFile('webview/styles/toolbar.css');
      const toolbarBlock = cssBlock(css, '.preview-toolbar');
      assert.ok(parseFloat(decl(toolbarBlock, 'gap')) >= 6, 'toolbar gap < 6px');
      const buttonBlock = cssBlock(css, '.toolbar-button');
      for (const prop of ['width', 'min-width', 'height']) {
        assert.ok(parseFloat(decl(buttonBlock, prop)) >= 32, `.toolbar-button ${prop} < 32px`);
      }
      assert.ok(/\.toolbar-button--labeled/.test(css), 'no labeled-button style');
      assert.ok(/\.toolbar-button-label/.test(css), 'no label text style');
      assert.ok(/\[data-label\]/.test(css), 'no hover-label tooltip style');
    });

    test('export buttons render visible text labels; a separator precedes the export group', () => {
      const document = makeDocument();
      loadWebviewModule<ToolbarModule>('toolbar.ts', document).initToolbar(fakeVscode());
      const buttons = Array.from(document.querySelectorAll('.toolbar-button'));
      assert.strictEqual(buttons.length, 7, 'expected 7 toolbar buttons');
      const pdf = buttons.find((b) => b.title === 'Export to PDF');
      const html = buttons.find((b) => b.title === 'Export to HTML');
      assert.ok(pdf && html, 'export buttons missing');
      for (const button of [pdf, html]) {
        assert.ok(
          (button!.textContent || '').trim().length > 0,
          `${button!.title} renders no visible label`
        );
        assert.ok(
          button!.querySelector('.toolbar-button-label'),
          `${button!.title} is missing .toolbar-button-label`
        );
      }
      assert.strictEqual(
        pdf!.previousElementSibling?.className,
        'toolbar-separator',
        'no separator immediately before the export group'
      );
    });

    test('every button has an accessible name; icon-only buttons carry a hover label', () => {
      const document = makeDocument();
      loadWebviewModule<ToolbarModule>('toolbar.ts', document).initToolbar(fakeVscode());
      const buttons = Array.from(document.querySelectorAll('.toolbar-button'));
      for (const button of buttons) {
        assert.ok(
          (button.getAttribute('aria-label') || '').length > 0,
          `button "${button.title}" has no aria-label`
        );
        if (!button.classList.contains('toolbar-button--labeled')) {
          assert.ok(
            (button.dataset.label || '').length > 0,
            `icon-only button "${button.title}" has no hover label`
          );
        }
      }
      // Clicking still posts the export messages.
      const doc2 = makeDocument();
      const vscode = fakeVscode();
      loadWebviewModule<ToolbarModule>('toolbar.ts', doc2).initToolbar(vscode);
      const doc2Buttons = Array.from(doc2.querySelectorAll('.toolbar-button'));
      doc2Buttons.find((b) => b.title === 'Export to PDF')!.click();
      doc2Buttons.find((b) => b.title === 'Export to HTML')!.click();
      assert.deepStrictEqual(
        vscode.posted.map((m) => m.type),
        ['exportToPdf', 'exportToHtml']
      );
    });
  });

  suite('theme persistence and honest TOC state (#69)', () => {
    test('theme toggle writes through vscode.setState and is restored on load', () => {
      const document = makeDocument();
      document.body.classList.add('vscode-dark');
      const vscode = fakeVscode();
      loadWebviewModule<ToolbarModule>('toolbar.ts', document).initToolbar(vscode);
      assert.ok(document.body.classList.contains('preview-theme-dark'), 'dark theme not applied');

      const themeButton = Array.from(document.querySelectorAll('.toolbar-button')).find(
        (b) => b.getAttribute('aria-label') === 'Switch to light theme'
      )!;
      themeButton.click();
      assert.strictEqual(vscode.state?.theme, 'light', 'toggle did not persist theme');
      assert.ok(document.body.classList.contains('preview-theme-light'));
      assert.strictEqual(themeButton.getAttribute('aria-pressed'), 'false');
      assert.strictEqual(themeButton.getAttribute('aria-label'), 'Switch to dark theme');

      // The write must merge — a scrollPosition stored by main.ts survives.
      vscode.state = { ...vscode.state, scrollPosition: 42 };
      themeButton.click();
      assert.strictEqual(vscode.state?.theme, 'dark');
      assert.strictEqual(vscode.state?.scrollPosition, 42, 'setState clobbered scrollPosition');
      assert.strictEqual(themeButton.getAttribute('aria-pressed'), 'true');

      // Reopen: a persisted choice wins over the host theme (no vscode-dark class here).
      const doc2 = makeDocument();
      loadWebviewModule<ToolbarModule>('toolbar.ts', doc2).initToolbar(fakeVscode(vscode.state));
      assert.ok(
        doc2.body.classList.contains('preview-theme-dark'),
        'persisted dark theme not restored on load'
      );
    });

    test('the TOC sidebar stays an overlay drawer under 500px — no display:none lie', () => {
      const css = readRepoFile('webview/styles/toc.css');
      assert.ok(
        !/display:\s*none\s*!important/.test(css),
        'display: none !important still present in toc.css'
      );
      const narrow = mediaQueryBody(css, '@media (max-width: 500px)');
      assert.ok(
        !/display\s*:\s*none/.test(narrow),
        'the 500px breakpoint still hides the TOC sidebar'
      );
    });

    test('toggleToc marks the button active exactly when the sidebar is visible', () => {
      const document = makeDocument();
      const toc = loadWebviewModule<TocModule>('toc.ts', document);
      const domUtils = loadWebviewModule<DomUtilsModule>('domUtils.ts', document);
      toc.initToc();
      const button = domUtils.createButton('<i></i>', 'Toggle Table of Contents', toc.toggleToc);
      toc.setTocToggleButton(button);
      const sidebar = document.querySelector('.toc-sidebar')!;
      assert.strictEqual(sidebar.classList.contains('toc-visible'), false);
      assert.strictEqual(button.classList.contains('toc-toggle-active'), false);
      assert.strictEqual(button.getAttribute('aria-pressed'), 'false');

      toc.toggleToc();
      assert.strictEqual(sidebar.classList.contains('toc-visible'), true);
      assert.strictEqual(button.classList.contains('toc-toggle-active'), true);
      assert.strictEqual(button.getAttribute('aria-pressed'), 'true');
      assert.ok(document.body.classList.contains('toc-open'));

      toc.toggleToc();
      assert.strictEqual(sidebar.classList.contains('toc-visible'), false);
      assert.strictEqual(button.classList.contains('toc-toggle-active'), false);
      assert.strictEqual(button.getAttribute('aria-pressed'), 'false');
      assert.ok(!document.body.classList.contains('toc-open'));
    });
  });
});
