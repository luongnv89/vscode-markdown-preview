import * as assert from 'assert';
import * as vscode from 'vscode';

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
});
