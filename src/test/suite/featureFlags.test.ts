import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { MarkdownEngine } from '../../markdownEngine';
import { PreviewConfig } from '../../types/messages';
import { buildWebviewHtml } from '../../utils/webviewHtml';
import { StandaloneHtmlBuilder } from '../../export/standaloneHtmlBuilder';

// Feature-flag regression tests (issue #32): markdownPreviewPro.enableMermaid
// and markdownPreviewPro.enableExcalidraw were contributed settings that no
// render path read. They must gate both the block emission in MarkdownEngine
// and the ~4.86 MB vendor script payload in the preview document and the
// standalone export HTML.

const repoRoot = path.resolve(__dirname, '..', '..', '..');

const BASE_CONFIG: PreviewConfig = {
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

const ABOUT_INFO = {
  version: '0.9.4',
  publisher: 'luongnv89',
  repo: 'https://github.com/luongnv89/vscode-markdown-preview',
  commit: 'abc1234',
};

const STUB_WEBVIEW = {
  cspSource: 'vscode-webview-resource:',
  asWebviewUri: (uri: vscode.Uri) => uri,
};

suite('feature flags enableMermaid / enableExcalidraw (#32)', () => {
  suite('MarkdownEngine block emission', () => {
    test('mermaid fence emits a .mermaid-block when enableMermaid is on', () => {
      const engine = new MarkdownEngine({ ...BASE_CONFIG, enableMermaid: true });
      const { html } = engine.render('```mermaid\ngraph TD; A-->B\n```');
      assert.ok(html.includes('class="mermaid-block"'), `no mermaid-block in: ${html}`);
    });

    test('mermaid fence emits a plain code block when enableMermaid is off', () => {
      const engine = new MarkdownEngine({ ...BASE_CONFIG, enableMermaid: false });
      const { html } = engine.render('```mermaid\ngraph TD; A-->B\n```');
      assert.ok(!html.includes('mermaid-block'), `mermaid-block emitted despite flag: ${html}`);
      assert.ok(html.includes('hljs code-block'), `no plain code block in: ${html}`);
      assert.ok(html.includes('graph TD;'), `diagram source lost: ${html}`);
    });

    test('excalidraw fence emits an .excalidraw-block when enableExcalidraw is on', () => {
      const engine = new MarkdownEngine({ ...BASE_CONFIG, enableExcalidraw: true });
      const { html } = engine.render('```excalidraw\n{"elements":[]}\n```');
      assert.ok(html.includes('class="excalidraw-block"'), `no excalidraw-block in: ${html}`);
    });

    test('excalidraw fence emits a plain code block when enableExcalidraw is off', () => {
      const engine = new MarkdownEngine({ ...BASE_CONFIG, enableExcalidraw: false });
      const { html } = engine.render('```excalidraw\n{"elements":[]}\n```');
      assert.ok(
        !html.includes('excalidraw-block'),
        `excalidraw-block emitted despite flag: ${html}`
      );
      assert.ok(html.includes('hljs code-block'), `no plain code block in: ${html}`);
    });

    test('updateConfig re-gates emission on the live engine', () => {
      const engine = new MarkdownEngine({ ...BASE_CONFIG, enableMermaid: true });
      engine.updateConfig({ ...BASE_CONFIG, enableMermaid: false });
      const { html } = engine.render('```mermaid\ngraph TD;\n```');
      assert.ok(!html.includes('mermaid-block'), `mermaid-block still emitted: ${html}`);
    });
  });

  suite('preview document vendor payload', () => {
    test('webview HTML omits mermaid/excalidraw vendor scripts when disabled', () => {
      const html = buildWebviewHtml(
        STUB_WEBVIEW,
        vscode.Uri.file(repoRoot),
        ABOUT_INFO,
        false,
        false,
        false
      );
      assert.ok(!html.includes('mermaid.min.js'), 'mermaid.min.js still referenced');
      assert.ok(
        !html.includes('excalidraw-utils.min.js'),
        'excalidraw-utils.min.js still referenced'
      );
      assert.ok(html.includes('katex.min.js'), 'katex.min.js missing');
      assert.ok(html.includes('main.js'), 'main.js missing');
      // script-src stays nonce-only — a shorter script list needs no CSP change.
      const csp = html.match(/Content-Security-Policy"\s+content="([^"]+)"/);
      assert.ok(csp && /script-src 'nonce-[^']+'/.test(csp[1]), `CSP weakened: ${csp && csp[1]}`);
    });

    test('webview HTML keeps mermaid/excalidraw vendor scripts by default', () => {
      const html = buildWebviewHtml(STUB_WEBVIEW, vscode.Uri.file(repoRoot), ABOUT_INFO, false);
      assert.ok(html.includes('mermaid.min.js'), 'mermaid.min.js missing by default');
      assert.ok(
        html.includes('excalidraw-utils.min.js'),
        'excalidraw-utils.min.js missing by default'
      );
    });
  });

  suite('export document vendor payload', () => {
    const builder = new StandaloneHtmlBuilder(vscode.Uri.file('/nonexistent-extension-dir'));
    const docUri = vscode.Uri.file('/tmp/export-doc.md');
    // Head embeds are `<script nonce="…">…</script>`; the render bootstrap is
    // the last nonced script in the document.
    const countVendorScripts = (html: string): number =>
      (html.match(/<script nonce=/g) || []).length;

    test('buildForBrowser drops the mermaid/excalidraw embeds when disabled', async () => {
      const off = await builder.buildForBrowser('<p>x</p>', 'doc', docUri, {
        enableMermaid: false,
        enableExcalidraw: false,
      });
      const on = await builder.buildForBrowser('<p>x</p>', 'doc', docUri, {
        enableMermaid: true,
        enableExcalidraw: true,
      });
      assert.strictEqual(
        countVendorScripts(off),
        countVendorScripts(on) - 2,
        `expected exactly 2 fewer embeds (off=${countVendorScripts(off)}, on=${countVendorScripts(on)})`
      );
    });
  });

  suite('configChanged webview handler', () => {
    test('webview/main.ts applies the new config instead of no-oping', () => {
      const src = fs.readFileSync(path.join(repoRoot, 'webview', 'main.ts'), 'utf8');
      const handlerStart = src.indexOf("case 'configChanged'");
      assert.ok(handlerStart !== -1, 'configChanged case missing');
      const handlerBody = src.slice(handlerStart, handlerStart + 300);
      assert.ok(/applyConfig\(/.test(handlerBody), 'configChanged handler still no-ops');
    });
  });
});
