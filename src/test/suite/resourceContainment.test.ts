import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  computeLocalResourceRoots,
  isDocumentCoveredByRoots,
  isPathInside,
  isPathInsideAny,
} from '../../utils/uri';
import { StandaloneHtmlBuilder } from '../../export/standaloneHtmlBuilder';
import { PreviewManager } from '../../previewManager';

// Resource-containment regression tests (issues #27, #28):
// - #27: startsWith() path-prefix checks are not containment — a sibling
//   directory sharing a prefix (/home/u/notes-private vs /home/u/notes) was
//   admitted, and refused assets were skipped silently.
// - #28: localResourceRoots included the filesystem root, so the webview could
//   read anywhere and the recreatePanel-on-uncovered-document branch was dead.

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// A real 1x1 PNG so embedImages can read and embed it.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

suite('path containment helpers (#27)', () => {
  test('isPathInside accepts the root itself and descendants', () => {
    assert.strictEqual(isPathInside('/home/u/notes', '/home/u/notes'), true);
    assert.strictEqual(isPathInside('/home/u/notes/x.png', '/home/u/notes'), true);
    assert.strictEqual(isPathInside('/home/u/notes/a/b/x.png', '/home/u/notes'), true);
  });

  test('isPathInside rejects a sibling directory sharing the path prefix', () => {
    // The startsWith bug: '/home/u/notes-private/x.png'.startsWith('/home/u/notes')
    // is true, so the old guard admitted sibling escapes.
    assert.strictEqual(isPathInside('/home/u/notes-private/x.png', '/home/u/notes'), false);
  });

  test('isPathInside rejects paths that escape via .. or live elsewhere', () => {
    assert.strictEqual(isPathInside('/etc/passwd', '/home/u/notes'), false);
    assert.strictEqual(isPathInside('/home/u/other/x.png', '/home/u/notes'), false);
  });

  test('isPathInsideAny matches against any of the allowed roots', () => {
    const roots = ['/home/u/notes', '/home/u/workspace'];
    assert.strictEqual(isPathInsideAny('/home/u/workspace/assets/x.png', roots), true);
    assert.strictEqual(isPathInsideAny('/home/u/notes-private/x.png', roots), false);
  });
});

suite('export image embedding containment (#27)', () => {
  test('a sibling-directory image is refused and produces a warning', async () => {
    const base = makeTempDir('mpp-notes-');
    const docDir = path.join(base, 'notes');
    const siblingDir = path.join(base, 'notes-private');
    fs.mkdirSync(docDir);
    fs.mkdirSync(siblingDir);
    fs.writeFileSync(path.join(siblingDir, 'x.png'), PNG_BYTES);

    const warnings: string[] = [];
    const builder = new StandaloneHtmlBuilder(vscode.Uri.file(repoRoot), (m) => warnings.push(m));
    const docUri = vscode.Uri.file(path.join(docDir, 'guide.md'));

    const html = await (
      builder as unknown as {
        embedImages(h: string, u: vscode.Uri, roots?: string[]): Promise<string>;
      }
    ).embedImages('<img src="../notes-private/x.png">', docUri, [docDir]);

    assert.ok(!html.includes('data:image/png;base64'), 'sibling image was embedded');
    assert.strictEqual(warnings.length, 1, 'no warning surfaced for the refused asset');
    assert.ok(
      warnings[0].includes('../notes-private/x.png'),
      `warning does not name the refused src: ${warnings[0]}`
    );
  });

  test('a workspace-relative ../assets/x.png is accepted when the workspace is a root', async () => {
    const wsDir = makeTempDir('mpp-ws-');
    const docDir = path.join(wsDir, 'docs');
    const assetsDir = path.join(wsDir, 'assets');
    fs.mkdirSync(docDir);
    fs.mkdirSync(assetsDir);
    fs.writeFileSync(path.join(assetsDir, 'x.png'), PNG_BYTES);

    const warnings: string[] = [];
    const builder = new StandaloneHtmlBuilder(vscode.Uri.file(repoRoot), (m) => warnings.push(m));
    const docUri = vscode.Uri.file(path.join(docDir, 'guide.md'));

    const html = await (
      builder as unknown as {
        embedImages(h: string, u: vscode.Uri, roots?: string[]): Promise<string>;
      }
    ).embedImages('<img src="../assets/x.png">', docUri, [docDir, wsDir]);

    assert.ok(
      html.includes('src="data:image/png;base64,'),
      `workspace-relative image was refused: ${html}`
    );
    assert.strictEqual(warnings.length, 0, `unexpected warnings: ${warnings.join(' | ')}`);
  });

  test('refused assets surface a user-visible warning through buildForBrowser', async () => {
    const outside = makeTempDir('mpp-outside-');
    const docDir = path.join(outside, 'docs');
    const secretDir = path.join(outside, 'elsewhere');
    fs.mkdirSync(docDir);
    fs.mkdirSync(secretDir);
    fs.writeFileSync(path.join(secretDir, 'hidden.png'), PNG_BYTES);

    const warnings: string[] = [];
    const builder = new StandaloneHtmlBuilder(vscode.Uri.file(repoRoot), (m) => warnings.push(m));
    const docUri = vscode.Uri.file(path.join(docDir, 'guide.md'));

    const html = await builder.buildForBrowser(
      '<p>ok</p><img src="../elsewhere/hidden.png">',
      'guide',
      docUri
    );

    assert.ok(
      !html.includes('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'),
      'image outside every allowed root was embedded'
    );
    assert.ok(warnings.length > 0, 'no warning surfaced for the refused asset');
  });
});

suite('webview localResourceRoots (#28)', () => {
  const extensionUri = vscode.Uri.file(repoRoot);
  const wsUri = vscode.Uri.file(path.join(os.tmpdir(), 'mpp-ws'));
  const docUri = vscode.Uri.file(path.join(wsUri.fsPath, 'docs', 'guide.md'));

  test('the filesystem root is never granted to the webview', () => {
    const roots = computeLocalResourceRoots(extensionUri, [wsUri], docUri);
    for (const root of roots) {
      const normalized = path.normalize(root.fsPath);
      assert.notStrictEqual(normalized, path.parse(normalized).root, `root grants ${normalized}`);
    }
  });

  test('roots are the webview bundle, workspace folders, and the document directory', () => {
    const roots = computeLocalResourceRoots(extensionUri, [wsUri], docUri).map((r) => r.fsPath);
    assert.ok(roots.includes(path.join(repoRoot, 'dist', 'webview')));
    assert.ok(roots.includes(wsUri.fsPath));
    assert.ok(roots.includes(path.join(wsUri.fsPath, 'docs')));
  });

  test('a file outside the workspace and the document directory is not resolvable', () => {
    const roots = computeLocalResourceRoots(extensionUri, [wsUri], docUri);
    const outsideDoc = vscode.Uri.file(path.join(makeTempDir('mpp-out-'), 'other.md'));
    assert.strictEqual(isDocumentCoveredByRoots(roots, outsideDoc), false);
    // What the webview would do with it: nothing — no root contains it.
    assert.strictEqual(
      isPathInsideAny(
        path.dirname(outsideDoc.fsPath),
        roots.map((r) => r.fsPath)
      ),
      false
    );
  });

  test('the recreatePanel guard can fire — an uncovered document is not covered', () => {
    const roots = computeLocalResourceRoots(extensionUri, [wsUri], docUri);
    // Covered: the document whose directory is itself a root.
    assert.strictEqual(isDocumentCoveredByRoots(roots, docUri), true);
    // Not covered: sibling-prefix directory (the old startsWith check said true).
    const siblingDoc = vscode.Uri.file(wsUri.fsPath + '-private/doc.md');
    assert.strictEqual(isDocumentCoveredByRoots(roots, siblingDoc), false);
  });

  test('recreatePanel recreates the webview with roots covering the new document', async () => {
    const docDir = makeTempDir('mpp-doc-');
    const otherDir = makeTempDir('mpp-other-');
    const docPath = path.join(docDir, 'a.md');
    const otherPath = path.join(otherDir, 'b.md');
    fs.writeFileSync(docPath, '# A\n');
    fs.writeFileSync(otherPath, '# B\n');

    const manager = new PreviewManager(extensionUri);
    try {
      const doc = await vscode.workspace.openTextDocument(docPath);
      const other = await vscode.workspace.openTextDocument(otherPath);
      const internals = manager as unknown as {
        createPanel(d: vscode.TextDocument, c: vscode.ViewColumn): void;
        recreatePanel(d: vscode.TextDocument): void;
        currentResourceRoots: vscode.Uri[];
      };

      internals.createPanel(doc, vscode.ViewColumn.Beside);
      assert.strictEqual(
        isDocumentCoveredByRoots(internals.currentResourceRoots, other.uri),
        false
      );

      internals.recreatePanel(other);
      assert.strictEqual(isDocumentCoveredByRoots(internals.currentResourceRoots, other.uri), true);
    } finally {
      manager.dispose();
    }
  });
});
