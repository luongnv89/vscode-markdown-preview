import * as assert from 'assert';
import * as vscode from 'vscode';
import { activate } from '../../extension';

suite('Extension Test Suite', () => {
  test('extension is present and activates', async () => {
    const extension = vscode.extensions.getExtension('luongnv89.markdown-preview-pro');
    assert.ok(extension, 'Expected extension luongnv89.markdown-preview-pro to be installed');
    await extension.activate();
    assert.strictEqual(extension.isActive, true);
  });

  test('markdown preview commands are registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    const expected = [
      'markdownPreviewPro.showPreview',
      'markdownPreviewPro.showPreviewToSide',
      'markdownPreviewPro.exportToHtml',
      'markdownPreviewPro.exportToPdf',
    ];
    for (const command of expected) {
      assert.ok(commands.includes(command), `Missing command: ${command}`);
    }
  });

  test('workspace API is available', () => {
    assert.ok(vscode.workspace, 'Expected the vscode workspace API to be available');
    assert.strictEqual([1, 2, 3].indexOf(4), -1);
  });

  // Regression test for issue #33: a failure inside activate() must surface a
  // user-visible error notification and re-throw so VS Code reports the
  // activation failure, instead of being swallowed by console.error alone.
  test('activation failure shows an error message and propagates (#33)', () => {
    const extension = vscode.extensions.getExtension('luongnv89.markdown-preview-pro');
    assert.ok(extension, 'Expected extension luongnv89.markdown-preview-pro to be installed');

    const shownMessages: string[] = [];
    const originalRegisterCommand = vscode.commands.registerCommand;
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    (vscode.commands as Record<string, unknown>).registerCommand = () => {
      throw new Error('injected registration failure');
    };
    (vscode.window as Record<string, unknown>).showErrorMessage = async (message: string) => {
      shownMessages.push(message);
      return undefined;
    };

    try {
      const fakeContext = {
        subscriptions: [] as vscode.Disposable[],
        extensionUri: extension.extensionUri,
      } as unknown as vscode.ExtensionContext;

      assert.throws(
        () => activate(fakeContext),
        /injected registration failure/,
        'activate() must re-throw a failing registration so VS Code reports it'
      );
      assert.ok(
        shownMessages.some((m) => m.includes('failed to activate')),
        'activate() must surface the failure via vscode.window.showErrorMessage'
      );
    } finally {
      (vscode.commands as Record<string, unknown>).registerCommand = originalRegisterCommand;
      (vscode.window as Record<string, unknown>).showErrorMessage = originalShowErrorMessage;
    }
  });

  // Regression test for issue #76: activation used to run
  // execSync('git rev-parse --short HEAD') in the PreviewManager constructor to
  // fill the About popup — a spawn that always fails on marketplace installs.
  // The SHA is now baked in at build time and the metadata collected lazily, so
  // activate() must never reach for a child process.
  test('activate() spawns no child process (#76)', () => {
    const extension = vscode.extensions.getExtension('luongnv89.markdown-preview-pro');
    assert.ok(extension, 'Expected extension luongnv89.markdown-preview-pro to be installed');

    const childProcess = require('child_process') as Record<string, unknown>;
    const spawned: string[] = [];
    const spawners = ['execSync', 'exec', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork'];
    const originals = new Map<string, unknown>();
    for (const name of spawners) {
      originals.set(name, childProcess[name]);
      childProcess[name] = () => {
        spawned.push(name);
        throw new Error(`unexpected child process during activate(): ${name}`);
      };
    }

    const originalRegisterCommand = vscode.commands.registerCommand;
    (vscode.commands as Record<string, unknown>).registerCommand = () => ({
      dispose: () => undefined,
    });

    try {
      const fakeContext = {
        subscriptions: [] as vscode.Disposable[],
        extensionUri: extension.extensionUri,
      } as unknown as vscode.ExtensionContext;

      activate(fakeContext);
      assert.deepStrictEqual(
        spawned,
        [],
        `activate() spawned child processes: ${spawned.join(', ')}`
      );
    } finally {
      for (const name of spawners) {
        childProcess[name] = originals.get(name);
      }
      (vscode.commands as Record<string, unknown>).registerCommand = originalRegisterCommand;
    }
  });
});
