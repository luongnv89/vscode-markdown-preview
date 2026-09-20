import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as esbuild from 'esbuild';
import { JSDOM } from 'jsdom';

// Diagram render-cache regression tests (issue #75): every updateContent used
// to re-render every diagram because incoming HTML re-flags each block
// data-processed="false" and `mermaid-${Date.now()}-${i}` produced a fresh id
// per render. Rendered output is now cached on a hash of the diagram source,
// so an update that only touches an unrelated paragraph must not call the
// render function again. Same jsdom + esbuild harness as
// webviewModules.test.ts.

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const webviewDir = path.join(repoRoot, 'webview');

interface TestDocument {
  body: { innerHTML: string };
  getElementById(id: string): TestElement | null;
  querySelector(sel: string): TestElement | null;
  querySelectorAll(sel: string): ArrayLike<TestElement>;
  createElement(tag: string): TestElement;
  createElementNS(ns: string, tag: string): TestElement;
}
interface TestElement {
  innerHTML: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelector(sel: string): TestElement | null;
  querySelectorAll(sel: string): ArrayLike<TestElement>;
}
interface TestWindow {
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(id: number): void;
  scrollTo(options?: unknown): void;
  scrollY: number;
  mermaid?: unknown;
  ExcalidrawUtils?: unknown;
}

interface RendererModule {
  updateContent(html: string): Promise<void>;
  applyConfig(config: unknown): void;
}

function makeDom(bodyHtml = ''): { document: TestDocument; window: TestWindow } {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`);
  return {
    document: dom.window.document as unknown as TestDocument,
    window: dom.window as unknown as TestWindow,
  };
}

// A tiny CommonJS loader (same pattern as webviewModules.test.ts): transpile
// webview/*.ts with the bundled esbuild and evaluate it with the jsdom globals
// the webview runs under. The webview layer only has relative './x' imports.
function loadWebviewModule<T>(entry: string, document: TestDocument, window: TestWindow): T {
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
      {},
      window.setTimeout.bind(window),
      window.clearTimeout.bind(window)
    );
    return module.exports;
  };
  return load(path.join(webviewDir, entry)) as T;
}

const MERMAID_SRC = 'graph TD; A-->B';
const EXCALIDRAW_SRC = '{"type":"excalidraw","version":2,"elements":[],"appState":{}}';

function mermaidBlock(source: string, dataLine = 3): string {
  return (
    `<div class="mermaid-block" data-processed="false" data-line="${dataLine}" ` +
    `data-source='${source}'><pre class="mermaid">${source}</pre></div>`
  );
}
function excalidrawBlock(source: string): string {
  return (
    `<div class="excalidraw-block" data-processed="false" ` +
    `data-source='${source}'><pre class="excalidraw-source">${source}</pre></div>`
  );
}
// A document whose only difference between versions is the paragraph text —
// the diagram block stays byte-identical, like an unrelated edit upstream.
function docWith(paragraph: string, blockHtml: string): string {
  return `<p class="code-line" data-line="0">${paragraph}</p>` + blockHtml;
}

function mermaidStub(calls: Array<{ id: string; code: string }>): unknown {
  return {
    initialize() {},
    async render(id: string, code: string) {
      calls.push({ id, code });
      return { svg: `<svg data-render-id="${id}"><text>stub</text></svg>` };
    },
  };
}

function excalidrawStub(document: TestDocument, calls: number[]): unknown {
  return {
    async exportToSvg() {
      calls.push(1);
      return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    },
  };
}

suite('webview renderer diagram cache (#75)', () => {
  test('an unrelated paragraph change does not re-render mermaid', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    const calls: Array<{ id: string; code: string }> = [];
    window.mermaid = mermaidStub(calls);
    const mod = loadWebviewModule<RendererModule>('renderer.ts', document, window);

    await mod.updateContent(docWith('version one', mermaidBlock(MERMAID_SRC)));
    assert.strictEqual(calls.length, 1, 'first render did not call mermaid.render');

    await mod.updateContent(docWith('version two', mermaidBlock(MERMAID_SRC)));
    assert.strictEqual(calls.length, 1, 'unchanged diagram was re-rendered on an unrelated edit');

    const container = document.getElementById('preview-content')!;
    assert.ok(container.innerHTML.includes('version two'), 'second update not applied');
    const block = container.querySelector('.mermaid-block')!;
    assert.strictEqual(block.getAttribute('data-processed'), 'true');
    assert.ok(block.innerHTML.includes('<svg'), 'cached SVG was not re-injected');
  });

  test('mermaid render ids are source-hash derived, not timestamps', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    const calls: Array<{ id: string; code: string }> = [];
    window.mermaid = mermaidStub(calls);
    const mod = loadWebviewModule<RendererModule>('renderer.ts', document, window);

    await mod.updateContent(docWith('v1', mermaidBlock(MERMAID_SRC)));
    assert.strictEqual(calls.length, 1);
    assert.match(
      calls[0].id,
      /^mermaid-[0-9a-z]{4,24}$/,
      `render id is not a base36 source hash: ${calls[0].id}`
    );
    assert.ok(!/^mermaid-\d{10,}/.test(calls[0].id), `render id is a timestamp: ${calls[0].id}`);
  });

  test('a changed mermaid source still re-renders', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    const calls: Array<{ id: string; code: string }> = [];
    window.mermaid = mermaidStub(calls);
    const mod = loadWebviewModule<RendererModule>('renderer.ts', document, window);

    await mod.updateContent(docWith('v1', mermaidBlock(MERMAID_SRC)));
    await mod.updateContent(docWith('v2', mermaidBlock('graph TD; A-->C')));
    assert.strictEqual(calls.length, 2, 'edited diagram source did not re-render');
  });

  test('a failed render is cached and the error block is rebuilt with data-line', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    let calls = 0;
    window.mermaid = {
      initialize() {},
      async render() {
        calls++;
        throw new Error('Parse error on line 1');
      },
    };
    const mod = loadWebviewModule<RendererModule>('renderer.ts', document, window);

    await mod.updateContent(docWith('v1', mermaidBlock('not a diagram', 7)));
    assert.strictEqual(calls, 1);
    let err = document.querySelector('.mermaid-error');
    assert.ok(err, 'error block not shown after failed render');
    assert.ok(
      err!.textContent!.includes('line 8'),
      `error lead did not name the document line: ${err!.textContent}`
    );

    await mod.updateContent(docWith('v2', mermaidBlock('not a diagram', 7)));
    assert.strictEqual(calls, 1, 'identical failing source was re-rendered');
    err = document.querySelector('.mermaid-error');
    assert.ok(err, 'cached error block not rebuilt on the next update');
    assert.ok(err!.textContent!.includes('line 8'), 'rebuilt error lost the data-line lead');
  });

  test('an unchanged excalidraw source is exported once across updates', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    const calls: number[] = [];
    window.ExcalidrawUtils = excalidrawStub(document, calls);
    const mod = loadWebviewModule<RendererModule>('renderer.ts', document, window);

    await mod.updateContent(docWith('v1', excalidrawBlock(EXCALIDRAW_SRC)));
    assert.strictEqual(calls.length, 1, 'first render did not export the diagram');

    await mod.updateContent(docWith('v2', excalidrawBlock(EXCALIDRAW_SRC)));
    assert.strictEqual(calls.length, 1, 'unchanged excalidraw re-exported on an unrelated edit');
    const block = document.querySelector('.excalidraw-block')!;
    assert.strictEqual(block.getAttribute('data-processed'), 'true');
  });

  test('queued updates coalesce and the drain applies the latest html', async () => {
    const { document, window } = makeDom('<div id="preview-content"></div>');
    const calls: Array<{ id: string; code: string }> = [];
    window.mermaid = mermaidStub(calls);
    const mod = loadWebviewModule<RendererModule>('renderer.ts', document, window);

    // The second call lands while the first is still in postProcess — it
    // queues, then drains inside the same updateContent invocation.
    const first = mod.updateContent(docWith('v1', mermaidBlock(MERMAID_SRC)));
    const second = mod.updateContent(docWith('v2', mermaidBlock(MERMAID_SRC)));
    await Promise.all([first, second]);

    const container = document.getElementById('preview-content')!;
    assert.ok(container.innerHTML.includes('v2'), 'queued update was not drained');
    assert.strictEqual(calls.length, 1, 'coalesced update re-rendered the diagram');
  });
});
