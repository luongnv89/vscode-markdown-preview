import * as assert from 'assert';
import * as vscode from 'vscode';
import { toggleCheckbox } from '../../checkboxHandler';

async function openMarkdown(content: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument({ language: 'markdown', content });
}

suite('toggleCheckbox', () => {
  test('checks an unchecked list item', async () => {
    const doc = await openMarkdown('- [ ] task one\n');
    assert.strictEqual(await toggleCheckbox(doc, 0, true), true);
    assert.strictEqual(doc.lineAt(0).text, '- [x] task one');
  });

  test('unchecks a checked list item', async () => {
    const doc = await openMarkdown('- [x] done\n');
    assert.strictEqual(await toggleCheckbox(doc, 0, false), true);
    assert.strictEqual(doc.lineAt(0).text, '- [ ] done');
  });

  test('characterization: checking an X-marked item normalizes to lowercase x', async () => {
    const doc = await openMarkdown('- [X] done\n');
    assert.strictEqual(await toggleCheckbox(doc, 0, true), true);
    assert.strictEqual(doc.lineAt(0).text, '- [x] done');
  });

  test('handles * and + bullets and indented items', async () => {
    const doc = await openMarkdown('  * [ ] nested\n+ [ ] plus\n');
    assert.strictEqual(await toggleCheckbox(doc, 0, true), true);
    assert.strictEqual(await toggleCheckbox(doc, 1, true), true);
    assert.strictEqual(doc.lineAt(0).text, '  * [x] nested');
    assert.strictEqual(doc.lineAt(1).text, '+ [x] plus');
  });

  test('returns false for a line that is not a checkbox', async () => {
    const doc = await openMarkdown('- plain item\n');
    assert.strictEqual(await toggleCheckbox(doc, 0, true), false);
    assert.strictEqual(doc.lineAt(0).text, '- plain item');
  });

  test('returns false for out-of-range line numbers', async () => {
    const doc = await openMarkdown('- [ ] task\n');
    assert.strictEqual(await toggleCheckbox(doc, -1, true), false);
    assert.strictEqual(await toggleCheckbox(doc, 99, true), false);
  });

  test('characterization: numbered-list items are not matched', async () => {
    // The regex anchors on a bullet marker (-, *, +), so "1. [ ]" is not a
    // checkbox under current behavior.
    const doc = await openMarkdown('1. [ ] numbered\n');
    assert.strictEqual(await toggleCheckbox(doc, 0, true), false);
    assert.strictEqual(doc.lineAt(0).text, '1. [ ] numbered');
  });
});
