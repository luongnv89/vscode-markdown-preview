import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as esbuild from 'esbuild';
import * as vscode from 'vscode';
import { JSDOM } from 'jsdom';
import { buildWebviewHtml } from '../../utils/webviewHtml';
import { createMarkdownIt } from '../../markdownCore';

// Webview UX regression tests (issues #68, #70):
// - #68: #preview-content ships a rendering placeholder (replaced by the
//   first updateContent) and diagram errors lead with the document line +
//   block type, raw parser output behind a <details>.
// - #70: the presentation nav hint is readable (>= 13px, full opacity before
//   fading), a document with zero <hr> gets a `---` convention notice, and
//   the three entrance animations honour prefers-reduced-motion.
//
// Webview modules cannot be imported directly (tsconfig.test is rooted at
// src/), so each is transpiled with esbuild and evaluated against jsdom —
// the same loader pattern as toolbarUx.test.ts / webviewModules.test.ts.

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const webviewDir = path.join(repoRoot, 'webview');

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

interface TestElement {
  className: string;
  textContent: string | null;
  innerHTML: string;
  dataset: Record<string, string | undefined>;
  style: Record<string, string>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  appendChild<T>(node: T): T;
  remove(): void;
  addEventListener(type: string, cb: (e: unknown) => void): void;
  querySelector(sel: string): TestElement | null;
  querySelectorAll(sel: string): ArrayLike<TestElement>;
}
interface TestDocument {
  body: TestElement;
  createElement(tag: string): TestElement;
  getElementById(id: string): TestElement | null;
  querySelector(sel: string): TestElement | null;
  querySelectorAll(sel: string): ArrayLike<TestElement>;
  addEventListener(type: string, cb: (e: unknown) => void): void;
}
interface TestWindow {
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(id: number): void;
  scrollTo(options?: unknown): void;
  scrollY: number;
  matchMedia(query: string): { matches: boolean };
  Event: new (type: string) => unknown;
  mermaid?: unknown;
  ExcalidrawUtils?: unknown;
}

interface RendererModule {
  updateContent(html: string): Promise<void>;
}
interface PresentationModule {
  enterPresentation(): void;
}

function makeDom(bodyHtml = ''): { document: TestDocument; window: TestWindow } {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`);
  return {
    document: dom.window.document as unknown as TestDocument,
    window: dom.window as unknown as TestWindow,
  };
}

// jsdom has no IntersectionObserver — the renderer's chrome refresh
// (blockHighlighter, toc) constructs one, so install a no-op stub globally.
class FakeIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as Record<string, unknown>).IntersectionObserver = FakeIntersectionObserver;

// Tiny CommonJS loader (same pattern as webviewModules.test.ts): transpile
// each webview/*.ts with the bundled esbuild and evaluate it with the jsdom
// globals the webview runs under.
function loadWebviewModule<T>(
  entry: string,
  document: TestDocument,
  window: TestWindow,
  navigator: Record<string, unknown>
): T {
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
      'navigator',
      'setTimeout',
      'clearTimeout',
      code
    );
    fn(
      module,
      module.exports,
      localRequire,
      document,
      window,
      navigator,
      window.setTimeout ? window.setTimeout.bind(window) : setTimeout,
      window.clearTimeout ? window.clearTimeout.bind(window) : clearTimeout
    );
    return module.exports;
  };
  return load(path.join(webviewDir, entry)) as T;
}

function stubScrollTo(window: TestWindow): void {
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: () => undefined });
}

function stubMatchMedia(window: TestWindow, matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches }),
  });
}

suite('rendering placeholder + readable diagram errors (#68)', () => {
  test('#preview-content ships non-empty placeholder markup', () => {
    const html = buildWebviewHtml(STUB_WEBVIEW, vscode.Uri.file(repoRoot), ABOUT_INFO, false);
    const dom = new JSDOM(html);
    const content = dom.window.document.querySelector('#preview-content');
    assert.ok(content, '#preview-content missing from emitted HTML');
    assert.ok(
      content!.innerHTML.trim().length > 0,
      '#preview-content ships empty — a blank preview looks identical to a failure'
    );
    assert.ok(
      content!.querySelector('.preview-placeholder'),
      'placeholder markup missing inside #preview-content'
    );
  });

  test('the first updateContent replaces the placeholder', async () => {
    const { document, window } = makeDom(
      '<div id="preview-content"><div class="preview-placeholder">Rendering preview…</div></div>'
    );
    stubScrollTo(window);
    const mod = loadWebviewModule<RendererModule>('renderer.ts', document, window, {});
    await mod.updateContent('<p>Real content</p>');

    const container = document.getElementById('preview-content')!;
    assert.ok(
      !container.querySelector('.preview-placeholder'),
      'placeholder survived the first updateContent'
    );
    assert.ok(container.innerHTML.includes('Real content'), 'rendered HTML missing');
  });

  test('a failing mermaid block reports the document line and keeps raw output in <details>', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    stubScrollTo(window);
    window.mermaid = {
      initialize: () => undefined,
      render: async () => {
        throw new Error('Parse error on line 1: Expecting SEMI');
      },
    };
    const mod = loadWebviewModule<RendererModule>('renderer.ts', document, window, {});
    // data-line="4" is the 0-based source map — the document line is 5.
    await mod.updateContent(
      '<div class="mermaid-block" data-processed="false" data-line="4" data-source="bogus">' +
        '<pre class="mermaid">bogus</pre></div>'
    );

    const error = document.querySelector('.mermaid-error');
    assert.ok(error, 'no .mermaid-error rendered');
    assert.ok(
      error!.textContent!.includes('document line 5'),
      `document line missing from error: ${error!.textContent}`
    );
    assert.ok(
      error!.textContent!.includes('mermaid'),
      `block type missing from error: ${error!.textContent}`
    );
    const details = error!.querySelector('details');
    assert.ok(details, 'raw parser output not behind a <details>');
    assert.ok(
      details!.textContent!.includes('Parse error on line 1'),
      `raw parser message missing: ${details!.textContent}`
    );
  });

  test('a failing excalidraw block reports the document line and keeps raw output in <details>', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    stubScrollTo(window);
    window.ExcalidrawUtils = { exportToSvg: async () => ({}) };
    const mod = loadWebviewModule<RendererModule>('renderer.ts', document, window, {});
    // data-line="7" is the 0-based source map — the document line is 8.
    await mod.updateContent(
      '<div class="excalidraw-block" data-processed="false" data-line="7" data-source="{bad">' +
        '<pre class="excalidraw-source">{bad</pre></div>'
    );

    const error = document.querySelector('.excalidraw-error');
    assert.ok(error, 'no .excalidraw-error rendered');
    assert.ok(
      error!.textContent!.includes('document line 8'),
      `document line missing from error: ${error!.textContent}`
    );
    assert.ok(
      error!.textContent!.includes('excalidraw'),
      `block type missing from error: ${error!.textContent}`
    );
    const details = error!.querySelector('details');
    assert.ok(details, 'raw parser output not behind a <details>');
    assert.ok(details!.textContent!.trim().length > 0, 'raw parser message missing from <details>');
  });

  test('the engine stamps the fence source line on diagram blocks', () => {
    const md = createMarkdownIt({
      typographer: false,
      lineBreaks: false,
      enableMermaid: true,
      enableExcalidraw: true,
      enableCheckboxes: true,
      enableKatex: true,
    });
    const html = md.render(
      '# Title\n\n```mermaid\ngraph TD; A-->B\n```\n\ntext\n\n```excalidraw\n{}\n```\n'
    );
    assert.ok(
      /<div class="mermaid-block" data-line="2"/.test(html),
      `mermaid block missing data-line: ${html}`
    );
    assert.ok(
      /<div class="excalidraw-block" data-line="8"/.test(html),
      `excalidraw block missing data-line: ${html}`
    );
  });
});

suite('presentation affordances + reduced motion (#70)', () => {
  test('a document with zero <hr> shows a notice explaining the --- convention', () => {
    const { document, window } = makeDom(
      '<div id="preview-content"><p>One long section, no breaks</p></div>'
    );
    stubMatchMedia(window, false);
    loadWebviewModule<PresentationModule>(
      'presentation.ts',
      document,
      window,
      {}
    ).enterPresentation();

    const notice = document.querySelector('.presentation-notice');
    assert.ok(notice, 'no .presentation-notice for a separator-less document');
    assert.ok(
      notice!.textContent!.includes('---'),
      `notice does not explain the --- convention: ${notice!.textContent}`
    );
  });

  test('an empty document still explains the --- convention instead of doing nothing', () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    stubMatchMedia(window, false);
    loadWebviewModule<PresentationModule>(
      'presentation.ts',
      document,
      window,
      {}
    ).enterPresentation();

    const notice = document.querySelector('.presentation-notice');
    assert.ok(notice, 'empty document still silently ignores presentation mode');
    assert.ok(notice!.textContent!.includes('---'), 'notice missing the --- hint');
  });

  test('a document with <hr> separators shows no notice and counts slides', () => {
    const { document, window } = makeDom(
      '<div id="preview-content"><p>one</p><hr><p>two</p></div>'
    );
    stubMatchMedia(window, false);
    loadWebviewModule<PresentationModule>(
      'presentation.ts',
      document,
      window,
      {}
    ).enterPresentation();

    assert.ok(
      !document.querySelector('.presentation-notice'),
      'notice shown despite <hr> separators'
    );
    assert.strictEqual(document.querySelector('.presentation-counter')!.textContent, '1 / 2');
  });

  test('the per-slide fade is skipped under prefers-reduced-motion', () => {
    const { document, window } = makeDom(
      '<div id="preview-content"><p>one</p><hr><p>two</p></div>'
    );
    stubMatchMedia(window, true);
    loadWebviewModule<PresentationModule>(
      'presentation.ts',
      document,
      window,
      {}
    ).enterPresentation();

    const slide = document.querySelector('.presentation-slide')!;
    const wrapper = slide.querySelector('div')!;
    assert.strictEqual(
      wrapper.style.animation || '',
      '',
      'slide fade applied despite prefers-reduced-motion'
    );
  });

  test('the nav hint is readable: >= 13px and full opacity before fading', () => {
    const css = readRepoFile('webview/styles/presentation.css');
    assert.ok(!/font-size:\s*11px/.test(css), 'presentation.css still carries font-size: 11px');
    const hint = css.match(/\.presentation-nav-hint\s*\{[^}]*\}/);
    assert.ok(hint, '.presentation-nav-hint rule missing');
    const size = hint![0].match(/font-size:\s*(\d+)px/);
    assert.ok(size && Number(size[1]) >= 13, `nav hint font too small: ${hint![0]}`);
    assert.ok(/opacity:\s*1\b/.test(hint![0]), 'nav hint must start at full opacity');
  });

  test('all three entrance animations live behind prefers-reduced-motion media queries', () => {
    const presentation = readRepoFile('webview/styles/presentation.css');
    const toc = readRepoFile('webview/styles/toc.css');

    const matches =
      (presentation.match(/prefers-reduced-motion/g) || []).length +
      (toc.match(/prefers-reduced-motion/g) || []).length;
    assert.ok(matches >= 2, `expected >= 2 prefers-reduced-motion guards, found ${matches}`);

    // The base rules must not carry the animations — they may only apply
    // inside a `@media (prefers-reduced-motion: no-preference)` block.
    for (const [name, rule] of [
      ['presentation-overlay', /\.presentation-overlay\s*\{[^}]*\}/],
      ['presentation-slide', /\.presentation-slide\s*\{[^}]*\}/],
      ['toc-sidebar', /\.toc-sidebar\s*\{[^}]*\}/],
    ] as const) {
      const css = name === 'toc-sidebar' ? toc : presentation;
      const block = css.match(rule);
      assert.ok(block, `.${name} base rule missing`);
      assert.ok(
        !/animation|transition/.test(block![0]),
        `.${name} still animates unconditionally: ${block![0]}`
      );
    }
  });
});
