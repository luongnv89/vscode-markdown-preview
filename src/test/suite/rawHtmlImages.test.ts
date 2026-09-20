import * as assert from 'assert';
import * as vscode from 'vscode';
import { MarkdownEngine } from '../../markdownEngine';
import { PreviewConfig } from '../../types/messages';

// Regression tests for issue #35: raw-HTML image URI rewriting moved out of a
// global post-render regex (which missed tags whose quoted attributes contain
// '>' and could touch markup examples in code) into the html_block/html_inline
// renderer rules, which only ever see raw-HTML tokens.

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

const DOC_URI = vscode.Uri.file('/workspace/docs/readme.md');
const RESOLVED = 'https://webview.invalid/workspace/docs/pic.png';

const STUB_WEBVIEW = {
  asWebviewUri: (uri: vscode.Uri) => vscode.Uri.parse('https://webview.invalid' + uri.path),
} as unknown as vscode.Webview;

function newEngine(): MarkdownEngine {
  const engine = new MarkdownEngine(BASE_CONFIG);
  engine.setContext(DOC_URI, STUB_WEBVIEW);
  return engine;
}

suite('MarkdownEngine raw-HTML image rewriting (#35)', () => {
  test('resolves an image tag inside a raw HTML block', () => {
    const { html } = newEngine().render('<div>\n<img src="pic.png">\n</div>\n');
    assert.ok(html.includes(`src="${RESOLVED}"`), `block tag not resolved: ${html}`);
  });

  test('resolves an image tag written as inline HTML in a paragraph', () => {
    const { html } = newEngine().render('Before <img src="pic.png"> after.\n');
    assert.ok(html.includes(`src="${RESOLVED}"`), `inline tag not resolved: ${html}`);
  });

  test('does not rewrite an image tag inside a fenced code block', () => {
    const { html } = newEngine().render('```\n<img src="pic.png">\n```\n');
    assert.ok(
      html.includes('&lt;img src=&quot;pic.png&quot;'),
      `fenced example was rewritten or lost: ${html}`
    );
    assert.ok(!html.includes('webview.invalid'), `fenced example was resolved: ${html}`);
  });

  test('does not rewrite an image tag inside inline code', () => {
    const { html } = newEngine().render('Use `<img src="pic.png">` here.\n');
    assert.ok(!html.includes('webview.invalid'), `inline code example was resolved: ${html}`);
  });

  test('resolves the image when a quoted attribute contains a > character', () => {
    const { html } = newEngine().render('<img title="2 > 1" src="pic.png">\n');
    assert.ok(html.includes(`src="${RESOLVED}"`), `tag with quoted > was not resolved: ${html}`);
    assert.ok(html.includes('title="2 > 1"'), `quoted attribute mangled: ${html}`);
  });

  test('resolves a relative badge path emitted by the frontmatter card', () => {
    const { html } = newEngine().render('---\nlogo: pic.png\n---\n# H\n');
    assert.ok(html.includes(`src="${RESOLVED}"`), `frontmatter badge was not resolved: ${html}`);
    assert.ok(html.includes('class="frontmatter-badge"'), `badge markup lost: ${html}`);
  });

  test('leaves remote image URLs untouched', () => {
    const { html } = newEngine().render('<img src="https://example.com/pic.png">\n');
    assert.ok(html.includes('src="https://example.com/pic.png"'), `remote URL changed: ${html}`);
  });
});
