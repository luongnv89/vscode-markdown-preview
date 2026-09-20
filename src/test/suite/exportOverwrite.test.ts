import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExportManager } from '../../export/exportManager';
import { findChromePath } from '../../export/browserFinder';

// Regression tests for issue #31: exporting must never overwrite an existing
// file without confirmation. The destination is resolved through
// `vscode.window.showSaveDialog` (pre-filled with `<basename>.<ext>` beside the
// source); a cancelled dialog aborts the export before anything is written.

type ShowSaveDialog = typeof vscode.window.showSaveDialog;

function chromeAvailable(): boolean {
  try {
    findChromePath();
    return true;
  } catch {
    return false;
  }
}

suite('export overwrite confirmation (#31)', function () {
  // The export pipeline launches headless Chromium; allow well over the
  // default 20s for tests that let the export run to completion.
  this.timeout(90000);

  let tmpDir: string;
  let mdUri: vscode.Uri;
  let extensionUri: vscode.Uri;
  let restore: Array<() => void>;

  function stubSaveDialog(result: vscode.Uri | undefined): void {
    const original = vscode.window.showSaveDialog;
    (vscode.window as { showSaveDialog: ShowSaveDialog }).showSaveDialog = async () => result;
    restore.push(() => {
      (vscode.window as { showSaveDialog: ShowSaveDialog }).showSaveDialog = original;
    });
  }

  function stubMessages(): void {
    // Notifications never resolve unattended in the dev host — answer them.
    for (const key of [
      'showInformationMessage',
      'showWarningMessage',
      'showErrorMessage',
    ] as const) {
      const original = vscode.window[key];
      (vscode.window as Record<string, unknown>)[key] = async () => undefined;
      restore.push(() => {
        (vscode.window as Record<string, unknown>)[key] = original;
      });
    }
  }

  setup(() => {
    restore = [];
    stubMessages();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpp-export-'));
    const mdPath = path.join(tmpDir, 'doc.md');
    fs.writeFileSync(mdPath, '# Hello Export\n\nSome content.\n');
    mdUri = vscode.Uri.file(mdPath);
    const ext = vscode.extensions.getExtension('luongnv89.markdown-preview-pro');
    assert.ok(ext, 'extension under test must be installed in the dev host');
    extensionUri = ext.extensionUri;
  });

  teardown(() => {
    for (const undo of restore.splice(0)) {
      undo();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('cancelling the save dialog does not overwrite an existing .html file', async () => {
    const target = path.join(tmpDir, 'doc.html');
    fs.writeFileSync(target, 'SENTINEL-DO-NOT-OVERWRITE');
    stubSaveDialog(undefined);

    await new ExportManager(extensionUri).exportToHtml(mdUri);

    assert.strictEqual(
      fs.readFileSync(target, 'utf-8'),
      'SENTINEL-DO-NOT-OVERWRITE',
      'existing .html file was overwritten without confirmation'
    );
  });

  test('cancelling the save dialog does not overwrite an existing .pdf file', async () => {
    const target = path.join(tmpDir, 'doc.pdf');
    fs.writeFileSync(target, 'SENTINEL-DO-NOT-OVERWRITE');
    stubSaveDialog(undefined);

    await new ExportManager(extensionUri).exportToPdf(mdUri);

    assert.strictEqual(
      fs.readFileSync(target, 'utf-8'),
      'SENTINEL-DO-NOT-OVERWRITE',
      'existing .pdf file was overwritten without confirmation'
    );
  });

  test('a confirmed save dialog choice writes to the chosen path', async function () {
    if (!chromeAvailable()) {
      this.skip();
    }
    const chosen = path.join(tmpDir, 'renamed-output.html');
    stubSaveDialog(vscode.Uri.file(chosen));

    await new ExportManager(extensionUri).exportToHtml(mdUri);

    assert.ok(fs.existsSync(chosen), 'export did not write to the path chosen in the dialog');
    const written = fs.readFileSync(chosen, 'utf-8');
    assert.ok(written.includes('Hello Export'), 'chosen file does not contain rendered markdown');
  });

  test('the save dialog is consulted with the derived output name', async () => {
    let consulted = false;
    const original = vscode.window.showSaveDialog;
    (vscode.window as { showSaveDialog: ShowSaveDialog }).showSaveDialog = async (options) => {
      consulted = true;
      assert.ok(
        options?.defaultUri?.fsPath.endsWith(`${path.sep}doc.html`),
        'save dialog must be pre-filled with the derived output name'
      );
      return undefined;
    };
    restore.push(() => {
      (vscode.window as { showSaveDialog: ShowSaveDialog }).showSaveDialog = original;
    });

    await new ExportManager(extensionUri).exportToHtml(mdUri);

    assert.ok(consulted, 'export never asked where to write the file');
  });
});
