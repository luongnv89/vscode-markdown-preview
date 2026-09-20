import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as esbuild from 'esbuild';
import { JSDOM } from 'jsdom';

// Coverage completion for the Sprint 6/7 webview rewrites (#65):
// webview/copyButton.ts (rewritten in #56 and #64) and webview/scrollSync.ts
// (rewritten in #64) had no test file, leaving the acceptance gate for
// "every rewritten module has >= 1 test file" unmet. Like toolbarUx.test.ts,
// each module is transpiled with esbuild and evaluated against jsdom — this
// harness additionally injects `window` and `navigator`, which these two
// modules reference.

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const webviewDir = path.join(repoRoot, 'webview');

interface TestClassList {
  add(c: string): void;
  remove(c: string): void;
  contains(c: string): boolean;
}
interface TestElement {
  className: string;
  title: string;
  textContent: string | null;
  innerHTML: string;
  parentElement: TestElement | null;
  classList: TestClassList;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  appendChild<T>(node: T): T;
  addEventListener(type: string, cb: (e: unknown) => void): void;
  click(): void;
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
  dispatchEvent(event: unknown): boolean;
}
interface TestWindow {
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(id: number): void;
  scrollTo(options?: unknown): void;
  scrollY: number;
  Event: new (type: string) => unknown;
}
interface TestNavigator {
  clipboard?: { writeText(text: string): Promise<void> };
}
interface FakeVscode {
  posted: Array<{ type: string; line?: number; source?: string }>;
  postMessage(msg: { type: string; line?: number; source?: string }): void;
}

interface CopyButtonModule {
  addCopyButtons(): void;
  COPIED_FEEDBACK_TIMEOUT: number;
}
interface ScrollSyncModule {
  initScrollSync(vscode: FakeVscode): void;
  scrollToLine(line: number): void;
  SCROLL_REPORT_THROTTLE: number;
  PROGRAMMATIC_SCROLL_LOCK: number;
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

// A tiny CommonJS loader (same pattern as toolbarUx.test.ts): transpile each
// webview/*.ts with the bundled esbuild and evaluate it with the jsdom globals
// the webview runs under. The webview layer only has relative './x' imports.
function loadWebviewModule<T>(
  entry: string,
  document: TestDocument,
  window: TestWindow,
  navigator: TestNavigator
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
    // setTimeout/clearTimeout must come from the same jsdom window the module
    // schedules on — pairing Node's clearTimeout with jsdom timer ids silently
    // fails to cancel and breaks throttle assertions.
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
  return load(path.join(webviewDir, entry)) as T;
}

suite('webview copyButton module (#65)', () => {
  test('wraps code blocks in a headered wrapper; mermaid blocks are skipped', () => {
    const { document, window } = makeDom(
      '<pre class="hljs" data-lang="ts"><code>const x = 1;</code></pre>' +
        '<pre class="hljs mermaid"><code>graph TD</code></pre>' +
        '<pre class="code-block"><code>plain</code></pre>'
    );
    const mod = loadWebviewModule<CopyButtonModule>('copyButton.ts', document, window, {});
    mod.addCopyButtons();

    const wrappers = Array.from(document.querySelectorAll('.code-block-wrapper'));
    assert.strictEqual(wrappers.length, 2, 'expected 2 wrapped blocks');
    const langLabels = Array.from(document.querySelectorAll('.code-block-lang'));
    assert.strictEqual(langLabels.length, 1, 'only the data-lang block gets a label');
    assert.strictEqual(langLabels[0].textContent, 'ts');
    const buttons = Array.from(document.querySelectorAll('.copy-button'));
    assert.strictEqual(buttons.length, 2);
    assert.strictEqual(buttons[0].title, 'Copy code');

    const mermaid = Array.from(document.querySelectorAll('pre.mermaid'));
    assert.strictEqual(mermaid.length, 1);
    assert.ok(
      !mermaid[0].parentElement?.classList.contains('code-block-wrapper'),
      'mermaid block must not be wrapped'
    );

    // Idempotent: a second pass must not re-wrap.
    mod.addCopyButtons();
    assert.strictEqual(
      document.querySelectorAll('.code-block-wrapper').length,
      2,
      'second pass re-wrapped blocks'
    );
  });

  test('clicking the copy button writes the code to the clipboard and shows feedback', async () => {
    const { document, window } = makeDom('<pre class="hljs"><code>hello world</code></pre>');
    const written: string[] = [];
    const navigator: TestNavigator = {
      clipboard: { writeText: async (t) => void written.push(t) },
    };
    loadWebviewModule<CopyButtonModule>(
      'copyButton.ts',
      document,
      window,
      navigator
    ).addCopyButtons();

    const button = document.querySelector('.copy-button')!;
    const initialIcon = button.innerHTML;
    button.click();
    await sleep(20);

    assert.deepStrictEqual(written, ['hello world'], 'clipboard did not receive the code');
    assert.ok(button.classList.contains('copied'), 'copied class not applied');
    assert.notStrictEqual(button.innerHTML, initialIcon, 'icon did not switch to the check mark');
  });

  test('falls back to execCommand when the clipboard API rejects', async () => {
    const { document, window } = makeDom('<pre class="hljs"><code>x</code></pre>');
    const execCommands: string[] = [];
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: (cmd: string) => {
        execCommands.push(cmd);
        return true;
      },
    });
    const navigator: TestNavigator = {
      clipboard: {
        writeText: () => Promise.reject(new Error('clipboard denied')),
      },
    };
    loadWebviewModule<CopyButtonModule>(
      'copyButton.ts',
      document,
      window,
      navigator
    ).addCopyButtons();

    const button = document.querySelector('.copy-button')!;
    button.click();
    await sleep(20);

    assert.deepStrictEqual(execCommands, ['copy'], 'execCommand fallback did not run');
    assert.ok(button.classList.contains('copied'), 'copied class not applied on fallback path');
  });
});

suite('webview scrollSync module (#65)', () => {
  test('scroll bursts are throttled into a single revealLine report', async () => {
    const { document, window } = makeDom(
      '<div class="code-line" data-line="5"></div><div class="code-line" data-line="20"></div>'
    );
    const vscode = fakeVscode();
    const mod = loadWebviewModule<ScrollSyncModule>('scrollSync.ts', document, window, {});
    mod.initScrollSync(vscode);

    for (let i = 0; i < 3; i++) {
      document.dispatchEvent(new window.Event('scroll'));
    }
    await sleep(mod.SCROLL_REPORT_THROTTLE + 80);

    assert.strictEqual(vscode.posted.length, 1, 'burst was not coalesced');
    assert.strictEqual(vscode.posted[0].type, 'revealLine');
    assert.strictEqual(vscode.posted[0].source, 'preview');
    assert.strictEqual(
      vscode.posted[0].line,
      20,
      'expected the last marker above the viewport top'
    );
  });

  test('scrollToLine scrolls and mutes scroll reporting during the programmatic lock', async () => {
    const { document, window } = makeDom(
      '<div class="code-line" data-line="10"></div><div class="code-line" data-line="20"></div>'
    );
    const scrollCalls: Array<unknown> = [];
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: (opts: unknown) => scrollCalls.push(opts),
    });
    const vscode = fakeVscode();
    const mod = loadWebviewModule<ScrollSyncModule>('scrollSync.ts', document, window, {});
    mod.initScrollSync(vscode);

    mod.scrollToLine(15);
    assert.strictEqual(scrollCalls.length, 1, 'window.scrollTo was not called');

    // Inside the lock window the scroll listener must stay muted.
    document.dispatchEvent(new window.Event('scroll'));
    await sleep(mod.SCROLL_REPORT_THROTTLE + 80);
    assert.strictEqual(vscode.posted.length, 0, 'programmatic scroll echo was reported');

    // After the lock expires a user scroll is reported again.
    await sleep(mod.PROGRAMMATIC_SCROLL_LOCK);
    document.dispatchEvent(new window.Event('scroll'));
    await sleep(mod.SCROLL_REPORT_THROTTLE + 80);
    assert.strictEqual(vscode.posted.length, 1, 'post-lock scroll was not reported');
    assert.strictEqual(vscode.posted[0].type, 'revealLine');
    assert.strictEqual(vscode.posted[0].line, 20);
  });
});
