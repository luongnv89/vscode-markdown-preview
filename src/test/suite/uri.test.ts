import * as assert from 'assert';
import * as vscode from 'vscode';
import { resolveImageUri } from '../../utils/uri';

const DOC = vscode.Uri.file('/workspace/docs/readme.md');

suite('resolveImageUri', () => {
  test('passes data: URIs through unchanged', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    assert.strictEqual(resolveImageUri(src, DOC), src);
  });

  test('passes http(s) URLs through unchanged', () => {
    for (const src of ['https://example.com/img.png', 'http://example.com/img.png']) {
      assert.strictEqual(resolveImageUri(src, DOC), src);
    }
  });

  test('resolves a relative path against the document directory in export mode', () => {
    const result = resolveImageUri('images/pic.png', DOC);
    assert.strictEqual(result, vscode.Uri.file('/workspace/docs/images/pic.png').fsPath);
  });

  test('characterization: ../ segments escape the document directory', () => {
    // Pins the current path-containment behavior (the F-BUG-003/F-BUG-005
    // boundary surface): no clamping to the document or workspace root is done.
    const result = resolveImageUri('../../outside.png', DOC);
    assert.strictEqual(result, vscode.Uri.file('/outside.png').fsPath);
  });

  test('parses file: URIs directly', () => {
    assert.strictEqual(resolveImageUri('file:///tmp/pic.png', DOC), '/tmp/pic.png');
  });

  test('treats a leading-slash path as an absolute filesystem path', () => {
    assert.strictEqual(resolveImageUri('/abs/pic.png', DOC), '/abs/pic.png');
  });

  test('characterization: drive-letter paths resolve via Uri.file on the host platform', () => {
    const src = 'C:\\img\\pic.png';
    assert.strictEqual(resolveImageUri(src, DOC), vscode.Uri.file(src).fsPath);
  });

  test('uses webview.asWebviewUri on the resolved Uri when a webview is supplied', () => {
    const seen: vscode.Uri[] = [];
    const webview = {
      asWebviewUri: (uri: vscode.Uri) => {
        seen.push(uri);
        return vscode.Uri.parse('https://webview.invalid' + uri.path);
      },
    } as unknown as vscode.Webview;

    const result = resolveImageUri('images/pic.png', DOC, webview);
    assert.strictEqual(result, 'https://webview.invalid/workspace/docs/images/pic.png');
    assert.strictEqual(seen.length, 1);
  });
});
