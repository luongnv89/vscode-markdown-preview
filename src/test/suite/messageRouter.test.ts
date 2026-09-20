import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  PreviewMessageContext,
  routeWebviewMessage,
  webviewMessageHandlers,
} from '../../messageRouter';
import { ScrollSync } from '../../scrollSync';
import { PreviewConfig, WebviewMessage } from '../../types/messages';

// Message-router regression tests (#62): the seven-case switch that lived in
// PreviewManager.handleWebviewMessage is now a dispatch table in
// src/messageRouter.ts, driven through a narrow PreviewMessageContext so the
// handlers can be exercised without a real panel, browser or export dialog.

const repoRoot = path.resolve(__dirname, '..', '..', '..');

const CONFIG: PreviewConfig = {
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

interface StubCalls {
  updated: vscode.TextDocument[];
  toggled: Array<{ line: number; checked: boolean }>;
  externals: vscode.Uri[];
  commands: Array<{ command: string; args: unknown[] }>;
}

function fakeDocument(uri: string): vscode.TextDocument {
  return { uri: vscode.Uri.parse(uri) } as vscode.TextDocument;
}

function makeContext(activeDocument: vscode.TextDocument | undefined): {
  ctx: PreviewMessageContext;
  calls: StubCalls;
} {
  const calls: StubCalls = { updated: [], toggled: [], externals: [], commands: [] };
  const ctx: PreviewMessageContext = {
    config: { ...CONFIG },
    scrollSync: new ScrollSync(),
    activeDocument,
    checkboxToggleInProgress: false,
    updatePreview: (document) => {
      calls.updated.push(document);
    },
    toggleCheckbox: (_document, line, checked) => {
      calls.toggled.push({ line, checked });
      return Promise.resolve(true);
    },
    openExternal: (uri) => {
      calls.externals.push(uri);
    },
    executeCommand: (command, ...args) => {
      calls.commands.push({ command, args });
    },
  };
  return { ctx, calls };
}

async function closeActiveEditor(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
}

suite('webview message router (#62)', () => {
  suite('dispatch table', () => {
    test('registers a handler for every message type the protocol sends', () => {
      const expected = [
        'exportToHtml',
        'exportToPdf',
        'navigateToLine',
        'openLink',
        'ready',
        'revealLine',
        'toggleCheckbox',
      ];
      assert.deepStrictEqual(Object.keys(webviewMessageHandlers).sort(), expected);
    });

    test('an unknown message type is ignored instead of throwing', () => {
      const { ctx, calls } = makeContext(undefined);
      const bogus = { type: 'notARealType' } as unknown as WebviewMessage;
      routeWebviewMessage(bogus, ctx);
      assert.strictEqual(calls.updated.length, 0);
      assert.strictEqual(calls.commands.length, 0);
    });
  });

  suite('ready', () => {
    test('re-renders the active document', () => {
      const doc = fakeDocument('file:///tmp/a.md');
      const { ctx, calls } = makeContext(doc);
      routeWebviewMessage({ type: 'ready' }, ctx);
      assert.deepStrictEqual(calls.updated, [doc]);
    });

    test('is a no-op without an active document', () => {
      const { ctx, calls } = makeContext(undefined);
      routeWebviewMessage({ type: 'ready' }, ctx);
      assert.strictEqual(calls.updated.length, 0);
    });
  });

  suite('revealLine', () => {
    test('locks scroll sync and reveals the line in the matching editor', async () => {
      const document = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: '# title\n\nbody\n',
      });
      const editor = await vscode.window.showTextDocument(document);
      try {
        const { ctx } = makeContext(document);
        routeWebviewMessage({ type: 'revealLine', line: 0, source: 'preview' }, ctx);
        assert.ok(ctx.scrollSync.isLocked(), 'scrollSync must lock after a reveal');
        assert.strictEqual(editor.visibleRanges[0].start.line, 0);
      } finally {
        await closeActiveEditor();
      }
    });

    test('does nothing when scroll sync is disabled', async () => {
      const document = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: '# title\n\nbody\n',
      });
      await vscode.window.showTextDocument(document);
      try {
        const { ctx } = makeContext(document);
        ctx.config.scrollSync = false;
        routeWebviewMessage({ type: 'revealLine', line: 0, source: 'preview' }, ctx);
        assert.ok(!ctx.scrollSync.isLocked(), 'scrollSync must stay unlocked');
      } finally {
        await closeActiveEditor();
      }
    });
  });

  suite('toggleCheckbox', () => {
    test('sets the in-progress flag, applies the edit and re-renders', async () => {
      const doc = fakeDocument('file:///tmp/a.md');
      const { ctx, calls } = makeContext(doc);
      routeWebviewMessage({ type: 'toggleCheckbox', line: 1, checked: true }, ctx);
      assert.deepStrictEqual(calls.toggled, [{ line: 1, checked: true }]);
      assert.ok(
        ctx.checkboxToggleInProgress,
        'flag must be set while the workspace edit is in flight'
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.ok(!ctx.checkboxToggleInProgress, 'flag must clear once the edit settles');
      assert.deepStrictEqual(calls.updated, [doc]);
    });

    test('is a no-op without an active document', () => {
      const { ctx, calls } = makeContext(undefined);
      routeWebviewMessage({ type: 'toggleCheckbox', line: 1, checked: true }, ctx);
      assert.strictEqual(calls.toggled.length, 0);
      assert.ok(!ctx.checkboxToggleInProgress);
    });
  });

  suite('navigateToLine', () => {
    test('selects and reveals the line in the matching editor', async () => {
      const document = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: 'one\ntwo\nthree\n',
      });
      const editor = await vscode.window.showTextDocument(document);
      try {
        const { ctx } = makeContext(document);
        routeWebviewMessage({ type: 'navigateToLine', line: 2 }, ctx);
        assert.strictEqual(editor.selection.active.line, 2);
      } finally {
        await closeActiveEditor();
      }
    });

    test('ignores the message when the editor shows a different document', async () => {
      const document = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: 'one\ntwo\nthree\n',
      });
      const editor = await vscode.window.showTextDocument(document);
      try {
        const { ctx } = makeContext(fakeDocument('file:///tmp/other.md'));
        routeWebviewMessage({ type: 'navigateToLine', line: 2 }, ctx);
        assert.strictEqual(editor.selection.active.line, 0);
      } finally {
        await closeActiveEditor();
      }
    });
  });

  suite('openLink', () => {
    test('forwards http(s) links and ignores every other scheme', () => {
      const { ctx, calls } = makeContext(undefined);
      routeWebviewMessage({ type: 'openLink', href: 'https://example.com/page' }, ctx);
      routeWebviewMessage({ type: 'openLink', href: 'http://example.com' }, ctx);
      routeWebviewMessage({ type: 'openLink', href: 'file:///etc/passwd' }, ctx);
      routeWebviewMessage({ type: 'openLink', href: 'javascript:alert(1)' }, ctx);
      assert.strictEqual(calls.externals.length, 2);
      assert.strictEqual(calls.externals[0].toString(), 'https://example.com/page');
      // Uri.parse normalizes a bare authority by appending the root path.
      assert.strictEqual(calls.externals[1].toString(), 'http://example.com/');
    });
  });

  suite('export commands', () => {
    test('dispatch through the context with the active document uri', () => {
      const doc = fakeDocument('file:///tmp/a.md');
      const { ctx, calls } = makeContext(doc);
      routeWebviewMessage({ type: 'exportToPdf' }, ctx);
      routeWebviewMessage({ type: 'exportToHtml' }, ctx);
      assert.deepStrictEqual(
        calls.commands.map((c) => c.command),
        ['markdownPreviewPro.exportToPdf', 'markdownPreviewPro.exportToHtml']
      );
      assert.strictEqual(calls.commands[0].args[0], doc.uri);
      assert.strictEqual(calls.commands[1].args[0], doc.uri);
    });

    test('dispatch undefined when no document is active', () => {
      const { ctx, calls } = makeContext(undefined);
      routeWebviewMessage({ type: 'exportToPdf' }, ctx);
      assert.strictEqual(calls.commands[0].args[0], undefined);
    });
  });

  suite('structure guards', () => {
    test('previewManager.ts stays under 200 lines with no case labels (#62 AC)', () => {
      const src = fs.readFileSync(path.join(repoRoot, 'src', 'previewManager.ts'), 'utf8');
      const lines = src.split('\n').length;
      assert.ok(lines < 200, `previewManager.ts grew back to ${lines} lines`);
      assert.ok(!/\bcase\s/.test(src), 'case labels must not return to previewManager.ts');
    });

    test('the message router and HTML template live in their own modules (#62 AC)', () => {
      for (const modulePath of [
        'src/messageRouter.ts',
        'src/utils/webviewHtml.ts',
        'src/previewEventBindings.ts',
        'src/utils/aboutInfo.ts',
      ]) {
        assert.ok(
          fs.existsSync(path.join(repoRoot, modulePath)),
          `${modulePath} is missing — the extraction regressed`
        );
      }
    });
  });
});
