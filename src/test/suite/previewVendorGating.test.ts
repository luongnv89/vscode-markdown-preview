import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as esbuild from 'esbuild';
import * as vscode from 'vscode';
import { JSDOM } from 'jsdom';
import { MarkdownEngine } from '../../markdownEngine';
import { buildWebviewHtml, PreviewAboutInfo } from '../../utils/webviewHtml';
import { PreviewManager } from '../../previewManager';
import { detectVendorNeeds } from '../../utils/vendorNeeds';
import { PreviewConfig } from '../../types/messages';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const webviewDir = path.join(repoRoot, 'webview');

const ABOUT_INFO: PreviewAboutInfo = { version: '0.0.1', publisher: 'test', repo: '', commit: '' };

const PLAIN_MARKDOWN = '# Plain README\n\nNo diagrams, no math. `katex-block` is just a word.\n';
const MATH_MARKDOWN = '# Math\n\nInline $E=mc^2$ math.\n';
const MERMAID_MARKDOWN = '# Diagram\n\n```mermaid\ngraph TD;\n  A-->B;\n```\n';
const EXCALIDRAW_MARKDOWN = '# Sketch\n\n```excalidraw\n{}\n```\n';

const ALL_FLAGS = { enableKatex: true, enableMermaid: true, enableExcalidraw: true };

/** vscode.Webview stub: asWebviewUri passes the fs path through so tests can
 * map emitted URLs back to real bundle files for byte accounting. */
const STUB_WEBVIEW = {
  cspSource: 'vscode-webview:',
  asWebviewUri(uri: vscode.Uri): vscode.Uri {
    return uri;
  },
} as unknown as vscode.Webview;

function previewConfig(overrides: Partial<PreviewConfig> = {}): PreviewConfig {
  return {
    scrollSync: true,
    enableMermaid: true,
    enableKatex: true,
    enableCheckboxes: true,
    enableExcalidraw: true,
    lineBreaks: false,
    typographer: true,
    showFrontmatter: 'card',
    allowRemoteImages: false,
    ...overrides,
  };
}

function fakeDocument(markdown: string, name = 'README.md'): vscode.TextDocument {
  return {
    uri: vscode.Uri.file(path.join(repoRoot, name)),
    getText: () => markdown,
  } as unknown as vscode.TextDocument;
}

/** Rendered-document needs → emitted preview HTML for the same flags. */
function htmlForMarkdown(markdown: string, config: PreviewConfig = previewConfig()): string {
  const engine = new MarkdownEngine(config);
  const { html } = engine.render(markdown);
  const needs = detectVendorNeeds(html, {
    enableKatex: config.enableKatex,
    enableMermaid: config.enableMermaid,
    enableExcalidraw: config.enableExcalidraw,
  });
  return buildWebviewHtml(
    STUB_WEBVIEW,
    vscode.Uri.file(repoRoot),
    ABOUT_INFO,
    false,
    ALL_FLAGS,
    needs
  );
}

/** Every tag that actually fetches a resource: <script src>, <link href>. */
function loadingTagUris(html: string): string[] {
  const uris: string[] = [];
  for (const match of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
    uris.push(match[1]);
  }
  for (const match of html.matchAll(/<link[^>]*\shref="([^"]+)"/g)) {
    uris.push(match[1]);
  }
  return uris;
}

/** Byte total of every *referenced* vendor asset — the number that ships to
 * the parser, matching the AC's "byte total of referenced vendor scripts". */
function referencedVendorBytes(html: string): number {
  return loadingTagUris(html)
    .filter((uri) => uri.includes('/vendor/'))
    .reduce((total, uri) => total + fs.statSync(vscode.Uri.parse(uri).fsPath).size, 0);
}

// ---------------------------------------------------------------------------
// Minimal jsdom harness for the webview modules — the same esbuild + local
// CommonJS-require pattern as previewUx.test.ts / webviewModules.test.ts
// (each test file keeps its own copy).
// ---------------------------------------------------------------------------

interface TestDocument {
  body: HTMLElement;
  head: HTMLElement;
  createElement(tag: string): HTMLElement;
  getElementById(id: string): HTMLElement | null;
  querySelector(sel: string): Element | null;
  querySelectorAll(sel: string): NodeListOf<Element>;
  addEventListener(type: string, cb: (e: unknown) => void): void;
}

interface TestWindow {
  document: TestDocument;
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(id: number): void;
  scrollTo(options?: unknown): void;
  scrollY: number;
  Event: new (type: string) => Event;
  mermaid?: unknown;
  ExcalidrawUtils?: unknown;
  katex?: unknown;
}

function makeDom(bodyHtml = '', headHtml = ''): { document: TestDocument; window: TestWindow } {
  const dom = new JSDOM(
    `<!doctype html><html><head>${headHtml}</head><body>${bodyHtml}</body></html>`
  );
  const window = dom.window as unknown as TestWindow;
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: () => undefined });
  return { document: dom.window.document as unknown as TestDocument, window };
}

// jsdom has no IntersectionObserver — the renderer's chrome refresh
// (blockHighlighter, toc) constructs one, so install a no-op stub globally.
class FakeIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as Record<string, unknown>).IntersectionObserver = FakeIntersectionObserver;

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

interface VendorLoaderModule {
  ensureVendor: (key: string) => Promise<boolean>;
  initVendorLoader: (nonce: string) => void;
  VENDOR_LOAD_TIMEOUT: number;
}

interface RendererModule {
  updateContent: (html: string) => Promise<void>;
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------

suite('preview vendor gating (#72)', () => {
  suite('detectVendorNeeds', () => {
    test('finds each runtime only through rendered block markup', () => {
      assert.deepStrictEqual(detectVendorNeeds('<div class="katex-block"></div>', ALL_FLAGS), {
        math: true,
        mermaid: false,
        excalidraw: false,
      });
      assert.deepStrictEqual(detectVendorNeeds('<div class="mermaid-block"></div>', ALL_FLAGS), {
        math: false,
        mermaid: true,
        excalidraw: false,
      });
      assert.deepStrictEqual(detectVendorNeeds('<div class="excalidraw-block"></div>', ALL_FLAGS), {
        math: false,
        mermaid: false,
        excalidraw: true,
      });
    });

    test('prose mentioning the class names does not trigger a vendor', () => {
      const prose =
        '<p>Classes like katex-block, mermaid-block and excalidraw-block are internal.</p>';
      assert.deepStrictEqual(detectVendorNeeds(prose, ALL_FLAGS), {
        math: false,
        mermaid: false,
        excalidraw: false,
      });
    });

    test('feature flags suppress detected markup', () => {
      const html = '<div class="mermaid-block"></div><div class="katex-block"></div>';
      assert.deepStrictEqual(
        detectVendorNeeds(html, {
          enableKatex: true,
          enableMermaid: false,
          enableExcalidraw: true,
        }),
        { math: true, mermaid: false, excalidraw: false }
      );
    });
  });

  suite('emitted HTML', () => {
    test('a document with no math and no diagrams ships zero vendor bundles', () => {
      const html = htmlForMarkdown(PLAIN_MARKDOWN);
      assert.ok(
        !/<script[^>]*\bsrc="[^"]*\/vendor\//.test(html),
        'vendor <script> emitted for a plain document'
      );
      assert.ok(
        !/<link[^>]*\bhref="[^"]*\/vendor\//.test(html),
        'vendor <link> emitted for a plain document'
      );
      for (const bundle of ['katex.min.js', 'mermaid.min.js', 'excalidraw-utils.min.js']) {
        assert.ok(
          !new RegExp(`<script[^>]*${bundle}`).test(html),
          `${bundle} script tag still emitted`
        );
      }
      assert.ok(!/<link[^>]*katex\.min\.css/.test(html), 'katex.min.css still emitted');
      // Core assets stay.
      assert.ok(/<script[^>]*main\.js/.test(html), 'main.js missing');
      assert.ok(/<link[^>]*main\.css/.test(html), 'main.css missing');
    });

    test('referenced vendor byte total for a plain document is 0 (< 300,000 B budget)', () => {
      const bytes = referencedVendorBytes(htmlForMarkdown(PLAIN_MARKDOWN));
      assert.strictEqual(bytes, 0, `plain document still references ${bytes} vendor bytes`);
      assert.ok(bytes < 300_000);
    });

    test('each feature emits exactly its own runtime — and no others', () => {
      const mathHtml = htmlForMarkdown(MATH_MARKDOWN);
      assert.ok(/<script[^>]*katex\.min\.js/.test(mathHtml), 'katex missing for math doc');
      assert.ok(/<link[^>]*katex\.min\.css/.test(mathHtml), 'katex css missing for math doc');
      assert.ok(!/<script[^>]*mermaid\.min\.js/.test(mathHtml), 'mermaid leaked into math doc');
      assert.ok(
        !/<script[^>]*excalidraw-utils\.min\.js/.test(mathHtml),
        'excalidraw leaked into math doc'
      );

      const mermaidHtml = htmlForMarkdown(MERMAID_MARKDOWN);
      assert.ok(/<script[^>]*mermaid\.min\.js/.test(mermaidHtml), 'mermaid missing');
      assert.ok(!/<script[^>]*katex\.min\.js/.test(mermaidHtml), 'katex leaked');
      assert.ok(!/<link[^>]*katex\.min\.css/.test(mermaidHtml), 'katex css leaked');

      const excalidrawHtml = htmlForMarkdown(EXCALIDRAW_MARKDOWN);
      assert.ok(/<script[^>]*excalidraw-utils\.min\.js/.test(excalidrawHtml), 'excalidraw missing');
      assert.ok(!/<script[^>]*mermaid\.min\.js/.test(excalidrawHtml), 'mermaid leaked');
      assert.ok(!/<script[^>]*katex\.min\.js/.test(excalidrawHtml), 'katex leaked');

      const allHtml = htmlForMarkdown(MATH_MARKDOWN + MERMAID_MARKDOWN + EXCALIDRAW_MARKDOWN);
      assert.ok(/<script[^>]*katex\.min\.js/.test(allHtml));
      assert.ok(/<script[^>]*mermaid\.min\.js/.test(allHtml));
      assert.ok(/<script[^>]*excalidraw-utils\.min\.js/.test(allHtml));
      assert.ok(/<link[^>]*katex\.min\.css/.test(allHtml));
    });

    test('every emitted vendor tag carries data-vendor for loader dedup', () => {
      const html = htmlForMarkdown(MERMAID_MARKDOWN);
      const tag = html.match(/<script[^>]*mermaid\.min\.js[^>]*>/);
      assert.ok(tag && /data-vendor="mermaid"/.test(tag[0]), `tag lacks data-vendor: ${tag}`);
    });

    test('data-vendor-* URI attributes always ship so the lazy loader can fetch on update', () => {
      const html = htmlForMarkdown(PLAIN_MARKDOWN);
      assert.ok(/data-vendor-katex="[^"]*katex\.min\.js/.test(html));
      assert.ok(/data-vendor-katex-css="[^"]*katex\.min\.css/.test(html));
      assert.ok(/data-vendor-mermaid="[^"]*mermaid\.min\.js/.test(html));
      assert.ok(/data-vendor-excalidraw="[^"]*excalidraw-utils\.min\.js/.test(html));
    });

    test('disabled feature flags suppress the tag even when markup needs it', () => {
      const html = buildWebviewHtml(
        STUB_WEBVIEW,
        vscode.Uri.file(repoRoot),
        ABOUT_INFO,
        false,
        { enableMermaid: false, enableExcalidraw: false, enableKatex: true },
        { mermaid: true, excalidraw: true, math: true }
      );
      assert.ok(!/<script[^>]*mermaid\.min\.js/.test(html));
      assert.ok(!/<script[^>]*excalidraw-utils\.min\.js/.test(html));
      assert.ok(/<script[^>]*katex\.min\.js/.test(html));
    });

    test('callers without detection keep the historical all-vendor payload', () => {
      const html = buildWebviewHtml(STUB_WEBVIEW, vscode.Uri.file(repoRoot), ABOUT_INFO, false);
      assert.ok(/<script[^>]*katex\.min\.js/.test(html));
      assert.ok(/<script[^>]*mermaid\.min\.js/.test(html));
      assert.ok(/<script[^>]*excalidraw-utils\.min\.js/.test(html));
    });

    test('the CSP stays nonce-only regardless of the emitted vendor set', () => {
      for (const markdown of [PLAIN_MARKDOWN, MERMAID_MARKDOWN]) {
        const html = htmlForMarkdown(markdown);
        const csp = html.match(/Content-Security-Policy"\s+content="([^"]+)"/);
        assert.ok(csp, 'CSP meta missing');
        const scriptSrc = csp![1].match(/script-src ([^;]+);/);
        assert.ok(
          scriptSrc && /^'nonce-[^']+'$/.test(scriptSrc[1].trim()),
          `script-src weakened: ${csp![1]}`
        );
      }
    });

    test('retainContextWhenHidden decision is documented with the post-gating figure', () => {
      const src = fs.readFileSync(path.join(repoRoot, 'src', 'previewManager.ts'), 'utf8');
      assert.ok(/retainContextWhenHidden:\s*true/.test(src), 'retainContextWhenHidden disabled');
      const commentBlock = src.split('retainContextWhenHidden: true')[0].slice(-600);
      assert.ok(
        /102\s*KB/.test(commentBlock),
        'post-gating payload figure (~102 KB) missing from the decision comment'
      );
    });

    test('PreviewManager.getWebviewHtml gates by the initial document content', () => {
      const manager = new PreviewManager(vscode.Uri.file(repoRoot));
      const plainHtml = manager.getWebviewHtml(STUB_WEBVIEW, fakeDocument(PLAIN_MARKDOWN));
      assert.ok(
        !/<script[^>]*\bsrc="[^"]*\/vendor\//.test(plainHtml),
        'getWebviewHtml still shipped vendor scripts for a plain document'
      );
      const mermaidHtml = manager.getWebviewHtml(STUB_WEBVIEW, fakeDocument(MERMAID_MARKDOWN));
      assert.ok(/<script[^>]*mermaid\.min\.js/.test(mermaidHtml), 'mermaid missing');
      // No document → the webview bootstrap/rebuild path keeps all vendors.
      const fallbackHtml = manager.getWebviewHtml(STUB_WEBVIEW);
      assert.ok(/<script[^>]*mermaid\.min\.js/.test(fallbackHtml), 'no-doc fallback lost mermaid');
    });
  });

  suite('vendorLoader', () => {
    const DATA_ATTRS =
      'data-vendor-katex="https://res/katex.min.js" ' +
      'data-vendor-katex-css="https://res/katex.min.css" ' +
      'data-vendor-mermaid="https://res/mermaid.min.js" ' +
      'data-vendor-excalidraw="https://res/excalidraw-utils.min.js"';

    function loadLoader(
      withUris = true,
      headHtml = ''
    ): {
      document: TestDocument;
      window: TestWindow;
      loader: VendorLoaderModule;
    } {
      const { document, window } = makeDom('<div id="preview-content"></div>', headHtml);
      if (withUris) {
        for (const attr of DATA_ATTRS.split(' ')) {
          const [name, value] = attr.split('=');
          document.body.setAttribute(name, value.replace(/"/g, ''));
        }
      }
      const loader = loadWebviewModule<VendorLoaderModule>('vendorLoader.ts', document, window, {});
      loader.initVendorLoader('test-nonce');
      return { document, window, loader };
    }

    test('injects a nonced script from the body data-vendor URI and resolves on load', async () => {
      const { window, loader } = loadLoader();
      const pending = loader.ensureVendor('mermaid');
      const script = window.document.head.querySelector(
        'script[data-vendor="mermaid"]'
      ) as HTMLScriptElement;
      assert.ok(script, 'vendor script not injected');
      assert.strictEqual(script.src, 'https://res/mermaid.min.js');
      assert.strictEqual(script.nonce, 'test-nonce');
      (window as { mermaid?: unknown }).mermaid = { render: async () => ({ svg: '' }) };
      script.dispatchEvent(new window.Event('load'));
      assert.strictEqual(await pending, true);
      // Second call short-circuits on the global — no duplicate tag.
      await loader.ensureVendor('mermaid');
      assert.strictEqual(
        window.document.head.querySelectorAll('script[data-vendor="mermaid"]').length,
        1
      );
    });

    test('dedupes concurrent ensures into a single script tag', async () => {
      const { window, loader } = loadLoader();
      const a = loader.ensureVendor('mermaid');
      const b = loader.ensureVendor('mermaid');
      assert.strictEqual(
        window.document.head.querySelectorAll('script[data-vendor="mermaid"]').length,
        1
      );
      const script = window.document.head.querySelector(
        'script[data-vendor="mermaid"]'
      ) as HTMLScriptElement;
      (window as { mermaid?: unknown }).mermaid = {};
      script.dispatchEvent(new window.Event('load'));
      assert.deepStrictEqual(await Promise.all([a, b]), [true, true]);
    });

    test('waits for a shipped (initial-HTML) tag instead of injecting a duplicate', async () => {
      const { window, loader } = loadLoader(
        true,
        '<script data-vendor="mermaid" src="https://res/mermaid.min.js" nonce="test-nonce"></script>'
      );
      const shipped = window.document.querySelector(
        'script[data-vendor="mermaid"]'
      ) as HTMLScriptElement;
      const pending = loader.ensureVendor('mermaid');
      await nextTick();
      assert.strictEqual(
        window.document.querySelectorAll('script[data-vendor="mermaid"]').length,
        1,
        'loader injected a duplicate tag'
      );
      (window as { mermaid?: unknown }).mermaid = {};
      shipped.dispatchEvent(new window.Event('load'));
      assert.strictEqual(await pending, true);
    });

    test('a missing data-vendor URI resolves false without injecting anything', async () => {
      const { window, loader } = loadLoader(false);
      assert.strictEqual(await loader.ensureVendor('mermaid'), false);
      assert.strictEqual(window.document.head.querySelectorAll('script').length, 0);
    });

    test('katex injects its stylesheet alongside the script', async () => {
      const { window, loader } = loadLoader();
      const pending = loader.ensureVendor('katex');
      const link = window.document.head.querySelector(
        'link[data-vendor-css="katex"]'
      ) as HTMLLinkElement;
      const script = window.document.head.querySelector(
        'script[data-vendor="katex"]'
      ) as HTMLScriptElement;
      assert.ok(link, 'katex stylesheet not injected');
      assert.strictEqual(link.href, 'https://res/katex.min.css');
      assert.strictEqual(link.rel, 'stylesheet');
      assert.ok(script, 'katex script not injected');
      (window as { katex?: unknown }).katex = { render: () => {} };
      script.dispatchEvent(new window.Event('load'));
      assert.strictEqual(await pending, true);
    });

    test('load failure resolves false and the next call retries cleanly', async () => {
      const { window, loader } = loadLoader();
      const first = loader.ensureVendor('mermaid');
      const script = window.document.head.querySelector(
        'script[data-vendor="mermaid"]'
      ) as HTMLScriptElement;
      script.dispatchEvent(new window.Event('error'));
      assert.strictEqual(await first, false);
      // The dead tag was dropped — a later ensure injects a fresh one.
      assert.strictEqual(
        window.document.head.querySelectorAll('script[data-vendor="mermaid"]').length,
        0,
        'failed tag was not cleaned up'
      );
      const second = loader.ensureVendor('mermaid');
      const retry = window.document.head.querySelectorAll('script[data-vendor="mermaid"]');
      assert.strictEqual(retry.length, 1, 'retry did not inject a fresh tag');
      (window as { mermaid?: unknown }).mermaid = {};
      (retry[0] as HTMLScriptElement).dispatchEvent(new window.Event('load'));
      assert.strictEqual(await second, true);
    });
  });

  suite('renderer lazy-load integration', () => {
    const BODY =
      'data-vendor-katex="https://res/katex.min.js" ' +
      'data-vendor-katex-css="https://res/katex.min.css" ' +
      'data-vendor-mermaid="https://res/mermaid.min.js" ' +
      'data-vendor-excalidraw="https://res/excalidraw-utils.min.js"';

    function loadRenderer(): {
      document: TestDocument;
      window: TestWindow;
      renderer: RendererModule;
    } {
      const { document, window } = makeDom('');
      for (const attr of BODY.split(' ')) {
        const [name, value] = attr.split('=');
        document.body.setAttribute(name, value.replace(/"/g, ''));
      }
      const content = document.createElement('div');
      content.id = 'preview-content';
      document.body.appendChild(content);
      const renderer = loadWebviewModule<RendererModule>('renderer.ts', document, window, {});
      return { document, window, renderer };
    }

    test('a mermaid block first appearing on update lazy-loads the runtime, then renders', async () => {
      const { window, renderer } = loadRenderer();
      const html =
        '<div class="mermaid-block" data-processed="false" data-source="graph TD; A--&gt;B;">' +
        '<pre class="mermaid">graph TD; A--&gt;B;</pre></div>';
      const pending = renderer.updateContent(html);
      const script = window.document.head.querySelector(
        'script[data-vendor="mermaid"]'
      ) as HTMLScriptElement;
      assert.ok(script, 'update did not trigger the mermaid lazy load');
      (window as { mermaid?: unknown }).mermaid = {
        initialize: () => {},
        render: async () => ({ svg: '<svg>mermaid-svg</svg>' }),
      };
      script.dispatchEvent(new window.Event('load'));
      await pending;
      const block = window.document.querySelector('.mermaid-block') as HTMLElement;
      assert.strictEqual(block.getAttribute('data-processed'), 'true');
      assert.ok(block.classList.contains('mermaid-rendered'), 'block not marked rendered');
      assert.ok(block.innerHTML.includes('mermaid-svg'), 'rendered svg missing');
    });

    test('math first appearing on update lazy-loads katex + its stylesheet', async () => {
      const { window, renderer } = loadRenderer();
      const pending = renderer.updateContent(
        '<p><span class="katex-inline" data-math="e=mc2"></span></p>'
      );
      // renderKatex runs behind the (early-returned) mermaid/excalidraw
      // awaits — let the microtask queue reach it before checking the DOM.
      await nextTick();
      const script = window.document.head.querySelector(
        'script[data-vendor="katex"]'
      ) as HTMLScriptElement;
      const link = window.document.head.querySelector('link[data-vendor-css="katex"]');
      assert.ok(script, 'update did not trigger the katex lazy load');
      assert.ok(link, 'update did not inject the katex stylesheet');
      (window as { katex?: unknown }).katex = {
        render: (math: string, el: HTMLElement) => {
          el.textContent = `MATH(${math})`;
        },
      };
      script.dispatchEvent(new window.Event('load'));
      await pending;
      const span = window.document.querySelector('.katex-inline') as HTMLElement;
      assert.strictEqual(span.textContent, 'MATH(e=mc2)');
    });

    test('a failed lazy load degrades to the existing warn path — block keeps its source', async () => {
      const { window, renderer } = loadRenderer();
      const html =
        '<div class="mermaid-block" data-processed="false" data-source="graph TD; A--&gt;B;">' +
        '<pre class="mermaid">graph TD; A--&gt;B;</pre></div>';
      const pending = renderer.updateContent(html);
      const script = window.document.head.querySelector(
        'script[data-vendor="mermaid"]'
      ) as HTMLScriptElement;
      script.dispatchEvent(new window.Event('error'));
      await pending;
      const block = window.document.querySelector('.mermaid-block') as HTMLElement;
      // Graceful degradation: the raw <pre> source stays visible, no throw.
      assert.strictEqual(block.getAttribute('data-processed'), 'false');
      assert.ok(block.querySelector('pre.mermaid'), 'source <pre> lost');
    });
  });
});
