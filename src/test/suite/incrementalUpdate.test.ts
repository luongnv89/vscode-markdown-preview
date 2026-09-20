import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as esbuild from 'esbuild';
import { JSDOM } from 'jsdom';

// Incremental preview update regression tests (issue #77): updateContent used
// to rebuild #preview-content with container.innerHTML on every update, so a
// one-character edit re-created every block, re-wrapped every code block, and
// re-registered every IntersectionObserver. The patch path diffs the incoming
// render's top-level blocks against the last applied render and replaces only
// the regions that changed. Same jsdom + esbuild harness as
// rendererCache.test.ts — but the loader shares one module cache between
// calls, so renderer.ts and the chrome modules it imports resolve to the same
// instances the entry point wires together.

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const webviewDir = path.join(repoRoot, 'webview');

interface TestDocument {
  body: { innerHTML: string };
  getElementById(id: string): TestElement | null;
  querySelector(sel: string): TestElement | null;
  querySelectorAll(sel: string): ArrayLike<TestElement>;
  createElement(tag: string): TestElement;
  createTextNode(text: string): unknown;
  addEventListener(type: string, cb: (e: unknown) => void): void;
  dispatchEvent(event: unknown): boolean;
}
interface TestElement {
  innerHTML: string;
  outerHTML: string;
  textContent: string | null;
  className: string;
  children: ArrayLike<TestElement>;
  checked?: boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  hasAttribute(name: string): boolean;
  querySelector(sel: string): TestElement | null;
  querySelectorAll(sel: string): ArrayLike<TestElement>;
  appendChild<T>(node: T): T;
  remove(): void;
}
interface TestWindow {
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(id: number): void;
  scrollTo(options?: unknown): void;
  scrollY: number;
  Event: new (type: string) => unknown;
  mermaid?: unknown;
}
interface FakeVscode {
  posted: Array<{ type: string; line?: number; source?: string }>;
  postMessage(msg: { type: string; line?: number; source?: string }): void;
}

interface RendererModule {
  updateContent(html: string): Promise<void>;
  applyConfig(config: unknown): void;
}
interface StatsBarModule {
  initStatsBar(): void;
}
interface TocModule {
  initToc(): void;
}
interface ScrollSyncModule {
  initScrollSync(vscode: FakeVscode): void;
  refreshScrollAnchors(container?: unknown): void;
  SCROLL_REPORT_THROTTLE: number;
}

// A recording IntersectionObserver: jsdom has none, and other suites install
// their own no-op stub globally at import time, so this file re-installs the
// recorder inside each test that needs it. It is a compatible superset —
// observe/unobserve/disconnect still exist — so later suites are unaffected.
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed = new Set<unknown>();
  constructor(_cb: (...args: unknown[]) => void) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: unknown): void {
    this.observed.add(el);
  }
  unobserve(el: unknown): void {
    this.observed.delete(el);
  }
  disconnect(): void {
    this.observed.clear();
  }
}

function installObserverRecorder(): void {
  FakeIntersectionObserver.instances = [];
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver =
    FakeIntersectionObserver;
}

function fakeVscode(): FakeVscode {
  return {
    posted: [],
    postMessage(msg) {
      this.posted.push(msg);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeDom(bodyHtml = ''): { document: TestDocument; window: TestWindow } {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`);
  return {
    document: dom.window.document as unknown as TestDocument,
    window: dom.window as unknown as TestWindow,
  };
}

function stubScrollTo(window: TestWindow): void {
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: () => undefined });
}

// The tiny CommonJS loader (same pattern as rendererCache.test.ts), wrapped
// in a factory so multiple entries share one module cache — loading
// 'renderer.ts' and 'toc.ts' through the same getter wires the same toc
// instance the renderer refreshes.
function makeLoader(
  document: TestDocument,
  window: TestWindow,
  navigator: Record<string, unknown> = {}
): <T>(entry: string) => T {
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
      window.setTimeout.bind(window),
      window.clearTimeout.bind(window)
    );
    return module.exports;
  };
  return <T>(entry: string) => load(path.join(webviewDir, entry)) as T;
}

function para(line: number, text: string): string {
  return `<p class="code-line" data-line="${line}">${text}</p>`;
}
function mermaidBlock(source: string, dataLine = 3): string {
  return (
    `<div class="mermaid-block" data-processed="false" data-line="${dataLine}" ` +
    `data-source='${source}'><pre class="mermaid">${source}</pre></div>`
  );
}

suite('incremental preview update patching (#77)', () => {
  test('an unrelated edit keeps sibling nodes and replaces only the changed block', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    stubScrollTo(window);
    const load = makeLoader(document, window);
    const mod = load<RendererModule>('renderer.ts');

    await mod.updateContent(para(0, 'one') + para(2, 'two') + para(4, 'three'));
    const container = document.getElementById('preview-content')!;
    const before = Array.from(container.children);

    await mod.updateContent(para(0, 'one') + para(2, 'TWO') + para(4, 'three'));
    const after = Array.from(container.children);

    assert.strictEqual(after.length, 3);
    assert.strictEqual(after[0], before[0], 'leading unchanged block was re-created');
    assert.strictEqual(after[2], before[2], 'trailing unchanged block was re-created');
    assert.notStrictEqual(after[1], before[1], 'changed block kept its old node');
    assert.strictEqual(after[1].textContent, 'TWO');
  });

  test('an inserted block keeps its siblings; a renumbered suffix is replaced', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    stubScrollTo(window);
    const load = makeLoader(document, window);
    const mod = load<RendererModule>('renderer.ts');

    await mod.updateContent(para(0, 'a') + para(5, 'c'));
    const container = document.getElementById('preview-content')!;
    const before = Array.from(container.children);

    // Realistic engine output: the inserted paragraph shifts the data-line
    // of what follows, so that block's signature changes and it is replaced —
    // but the untouched prefix keeps its node.
    await mod.updateContent(para(0, 'a') + para(2, 'b') + para(5, 'c2'));
    const after = Array.from(container.children);

    assert.strictEqual(after.length, 3);
    assert.strictEqual(after[0], before[0], 'unchanged prefix was re-created');
    assert.strictEqual(after[1].textContent, 'b');
    assert.strictEqual(after[2].textContent, 'c2');
  });

  test('an unchanged mermaid block keeps its node and rendered SVG', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    stubScrollTo(window);
    const calls: Array<{ id: string; code: string }> = [];
    window.mermaid = {
      initialize() {},
      async render(id: string, code: string) {
        calls.push({ id, code });
        return { svg: `<svg data-render-id="${id}"></svg>` };
      },
    };
    const load = makeLoader(document, window);
    const mod = load<RendererModule>('renderer.ts');
    const block = mermaidBlock('graph TD; A-->B');

    await mod.updateContent(para(0, 'v1') + block);
    const container = document.getElementById('preview-content')!;
    const mermaidNode = container.querySelector('.mermaid-block')!;

    await mod.updateContent(para(0, 'v2') + block);

    assert.strictEqual(calls.length, 1, 'unchanged diagram re-rendered');
    assert.strictEqual(
      container.querySelector('.mermaid-block'),
      mermaidNode,
      'unchanged diagram block lost its node'
    );
    assert.strictEqual(mermaidNode.getAttribute('data-processed'), 'true');
    assert.ok(mermaidNode.innerHTML.includes('<svg'), 'rendered SVG was discarded');
  });

  test('an identical render mutates nothing', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    stubScrollTo(window);
    const load = makeLoader(document, window);
    const mod = load<RendererModule>('renderer.ts');
    const html = para(0, 'same') + para(2, 'content');

    await mod.updateContent(html);
    const container = document.getElementById('preview-content')!;
    const before = Array.from(container.children);

    await mod.updateContent(html);

    const after = Array.from(container.children);
    assert.strictEqual(after.length, before.length);
    before.forEach((el, i) =>
      assert.strictEqual(after[i], el, `identical render re-created block ${i}`)
    );
  });

  test('a kept task list re-syncs checkbox state to the source', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    stubScrollTo(window);
    const load = makeLoader(document, window);
    const mod = load<RendererModule>('renderer.ts');
    const list =
      '<ul class="code-line" data-line="0"><li data-line="0">' +
      '<input type="checkbox" data-line="0"> task</li></ul>';

    await mod.updateContent(list + para(2, 'x'));
    const box = document.querySelector('input[type="checkbox"]')!;
    box.checked = true; // a user click flips the property, never the attribute

    await mod.updateContent(list + para(2, 'y'));

    const after = document.querySelector('input[type="checkbox"]')!;
    assert.strictEqual(
      after.checked,
      false,
      'kept checkbox stayed checked although the source still says unchecked'
    );
  });

  test('a kept blockquote task list re-syncs checkbox state to the source', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    stubScrollTo(window);
    const load = makeLoader(document, window);
    const mod = load<RendererModule>('renderer.ts');
    const quote =
      '<blockquote><ul class="code-line" data-line="0"><li data-line="0">' +
      '<input type="checkbox" data-line="0"> task</li></ul></blockquote>';

    await mod.updateContent(quote + para(2, 'x'));
    const box = document.querySelector('input[type="checkbox"]')!;
    box.checked = true; // a user click flips the property, never the attribute

    await mod.updateContent(quote + para(2, 'y'));

    const after = document.querySelector('input[type="checkbox"]')!;
    assert.strictEqual(
      after.checked,
      false,
      'kept nested checkbox stayed checked although the source still says unchecked'
    );
  });

  test('a kept code block keeps its copy-button wrapper', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    stubScrollTo(window);
    const load = makeLoader(document, window);
    const mod = load<RendererModule>('renderer.ts');
    const code = '<pre class="hljs code-block" data-lang="ts"><code>x()</code></pre>';

    await mod.updateContent(para(0, 'v1') + code);
    const container = document.getElementById('preview-content')!;
    const wrapper = container.querySelector('.code-block-wrapper')!;
    assert.ok(wrapper, 'code block was not wrapped on first render');

    await mod.updateContent(para(0, 'v2') + code);

    assert.strictEqual(
      container.querySelector('.code-block-wrapper'),
      wrapper,
      'kept code block was re-wrapped'
    );
    assert.strictEqual(container.querySelectorAll('.copy-button').length, 1);
  });

  test('the stats bar still updates from the patched blocks', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    stubScrollTo(window);
    const load = makeLoader(document, window);
    load<StatsBarModule>('statsBar.ts').initStatsBar();
    const mod = load<RendererModule>('renderer.ts');

    await mod.updateContent(para(0, 'hello world'));
    let bar = document.querySelector('.stats-bar')!;
    assert.ok(bar.textContent!.includes('2 words'), `stats: ${bar.textContent}`);

    await mod.updateContent(para(0, 'hello brave new world'));
    bar = document.querySelector('.stats-bar')!;
    assert.ok(bar.textContent!.includes('4 words'), `stats: ${bar.textContent}`);
  });

  test('the TOC keeps its entries across edits that leave headings unchanged', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    stubScrollTo(window);
    installObserverRecorder();
    const load = makeLoader(document, window);
    load<TocModule>('toc.ts').initToc();
    const mod = load<RendererModule>('renderer.ts');
    const head = '<h1 class="code-line" data-line="0">Title</h1>';

    await mod.updateContent(head + para(2, 'a'));
    const first = document.querySelector('.toc-sidebar a')!;
    assert.ok(first, 'no TOC entry after first render');

    await mod.updateContent(head + para(2, 'b'));
    assert.strictEqual(
      document.querySelector('.toc-sidebar a'),
      first,
      'unchanged headings rebuilt the TOC entries'
    );

    await mod.updateContent('<h1 class="code-line" data-line="0">Retitled</h1>' + para(2, 'b'));
    const retitled = document.querySelector('.toc-sidebar a')!;
    assert.notStrictEqual(retitled, first, 'changed heading did not rebuild the TOC');
    assert.strictEqual(retitled.textContent, 'Retitled');
  });

  test('a heading whose markup changed rebuilds its TOC entry', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    stubScrollTo(window);
    const load = makeLoader(document, window);
    load<TocModule>('toc.ts').initToc();
    const mod = load<RendererModule>('renderer.ts');
    const head1 = '<h2 class="code-line" data-line="0"><a href="u1">x</a></h2>';
    const head2 = '<h2 class="code-line" data-line="0"><a href="u2">x</a></h2>';

    await mod.updateContent(head1 + para(2, 'a'));
    const first = document.querySelector('.toc-sidebar a')!;
    assert.ok(first, 'no TOC entry after first render');

    // Same tag, data-line and textContent — only the inner markup changed —
    // so the heading node is replaced while a text-level signature matches.
    // The TOC must not keep a click target bound to the detached node.
    await mod.updateContent(head2 + para(2, 'a'));

    const retargeted = document.querySelector('.toc-sidebar a')!;
    assert.notStrictEqual(
      retargeted,
      first,
      'replaced heading kept a TOC entry bound to the detached node'
    );
  });

  test('a heading inside a replaced blockquote rebuilds its TOC entry', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    stubScrollTo(window);
    const load = makeLoader(document, window);
    load<TocModule>('toc.ts').initToc();
    const mod = load<RendererModule>('renderer.ts');
    const head = '<h2 class="code-line" data-line="0">x</h2>';
    const quote = (text: string) =>
      `<blockquote><p class="code-line" data-line="2">${text}</p>${head}</blockquote>`;

    await mod.updateContent(quote('one'));
    const first = document.querySelector('.toc-sidebar a')!;
    assert.ok(first, 'no TOC entry after first render');

    // The blockquote is replaced wholesale, so the heading arrives as a new
    // node even though its tag, data-line and markup are all unchanged.
    await mod.updateContent(quote('two'));

    const retargeted = document.querySelector('.toc-sidebar a')!;
    assert.notStrictEqual(
      retargeted,
      first,
      'heading inside a replaced blockquote kept a stale TOC entry'
    );
  });

  test('a stray container child is swept on the next update', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    stubScrollTo(window);
    const load = makeLoader(document, window);
    const mod = load<RendererModule>('renderer.ts');

    await mod.updateContent(para(0, 'one'));
    const container = document.getElementById('preview-content')!;
    const stray = document.createElement('div');
    stray.className = 'stray';
    container.appendChild(stray);

    await mod.updateContent(para(0, 'two'));

    assert.ok(!container.querySelector('.stray'), 'stray element survived the update');
    assert.strictEqual(container.children.length, 1);
    assert.strictEqual(container.children[0].textContent, 'two');
  });

  test('a config flag toggle still rebuilds the whole render', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    stubScrollTo(window);
    window.mermaid = {
      initialize() {},
      async render(id: string) {
        return { svg: `<svg data-render-id="${id}"></svg>` };
      },
    };
    const load = makeLoader(document, window);
    const mod = load<RendererModule>('renderer.ts');
    const html = para(0, 'v') + mermaidBlock('graph TD; A-->B');

    await mod.updateContent(html);
    const container = document.getElementById('preview-content')!;
    const before = Array.from(container.children);

    mod.applyConfig({ enableMermaid: false, enableExcalidraw: true });
    await sleep(20);

    const after = Array.from(container.children);
    assert.strictEqual(after.length, before.length);
    assert.notStrictEqual(after[1], before[1], 'flag toggle kept the rendered diagram node');
    assert.strictEqual(
      after[1].getAttribute('data-processed'),
      'false',
      'rebuilt diagram block is unprocessed again'
    );
  });

  test('scroll reporting still posts revealLine after an update', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    stubScrollTo(window);
    installObserverRecorder();
    const load = makeLoader(document, window);
    const scrollMod = load<ScrollSyncModule>('scrollSync.ts');
    const vscode = fakeVscode();
    scrollMod.initScrollSync(vscode);
    const mod = load<RendererModule>('renderer.ts');

    await mod.updateContent(para(5, 'a') + para(20, 'b'));
    document.dispatchEvent(new window.Event('scroll'));
    await sleep(scrollMod.SCROLL_REPORT_THROTTLE + 80);

    assert.strictEqual(vscode.posted.length, 1, 'scroll burst was not reported once');
    assert.strictEqual(vscode.posted[0].type, 'revealLine');
    assert.strictEqual(vscode.posted[0].line, 20);
  });

  test('scroll anchors observe inserted code-lines and unobserve removed ones', async () => {
    const { document, window } = makeDom(
      '<div id="preview-content"><p class="code-line" data-line="1"></p></div>'
    );
    installObserverRecorder();
    const load = makeLoader(document, window);
    const scrollMod = load<ScrollSyncModule>('scrollSync.ts');
    scrollMod.initScrollSync(fakeVscode());
    const container = document.getElementById('preview-content')!;
    const io = FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1];

    const first = container.children[0];
    scrollMod.refreshScrollAnchors(container);
    assert.ok(io.observed.has(first), 'existing code-line was not observed');

    container.innerHTML = '<p class="code-line" data-line="9"></p>';
    const next = container.children[0];
    scrollMod.refreshScrollAnchors(container);
    assert.ok(!io.observed.has(first), 'removed code-line was not unobserved');
    assert.ok(io.observed.has(next), 'inserted code-line was not observed');
  });
});
