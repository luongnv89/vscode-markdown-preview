import * as assert from 'assert';
import { MarkdownEngine } from '../../markdownEngine';
import { PreviewConfig } from '../../types/messages';
import { parseFrontmatter } from '../../utils/frontmatter';

suite('parseFrontmatter', () => {
  test('returns null frontmatter when the document has no front matter block', () => {
    const content = '# Title\n\nBody text.\n';
    const result = parseFrontmatter(content);
    assert.strictEqual(result.frontmatter, null);
    assert.strictEqual(result.body, content);
    assert.strictEqual(result.linesConsumed, 0);
  });

  test('parses a YAML front matter block and returns the remaining body', () => {
    const content = '---\ntitle: Hello\nauthor: Ada\n---\n# Heading\n';
    const result = parseFrontmatter(content);
    assert.deepStrictEqual(result.frontmatter, { title: 'Hello', author: 'Ada' });
    assert.strictEqual(result.body, '# Heading\n');
    assert.strictEqual(result.linesConsumed, 4);
  });

  test('strips an empty front matter block without producing metadata', () => {
    const content = '---\n\n---\nBody.\n';
    const result = parseFrontmatter(content);
    assert.strictEqual(result.frontmatter, null);
    assert.strictEqual(result.body, 'Body.\n');
    assert.strictEqual(result.linesConsumed, 3);
  });

  test('characterization: an immediately adjacent --- pair is not treated as a block', () => {
    // The closing delimiter must be preceded by \n, so '---\n---' never
    // matches — the "empty block" branch is only reachable via a blank line.
    const content = '---\n---\nBody.\n';
    const result = parseFrontmatter(content);
    assert.strictEqual(result.frontmatter, null);
    assert.strictEqual(result.body, content);
    assert.strictEqual(result.linesConsumed, 0);
  });

  test('strips the block and reports no metadata when the YAML is malformed', () => {
    const content = '---\ntitle: [unclosed\n---\nBody.\n';
    const result = parseFrontmatter(content);
    assert.strictEqual(result.frontmatter, null);
    assert.strictEqual(result.body, 'Body.\n');
  });

  test('characterization: a block that parses to a scalar yields null metadata', () => {
    const content = '---\njust a string\n---\nBody.\n';
    const result = parseFrontmatter(content);
    assert.strictEqual(result.frontmatter, null);
    assert.strictEqual(result.body, 'Body.\n');
  });

  test('characterization: a YAML list passes the object check and is kept as metadata', () => {
    const content = '---\n- one\n- two\n---\nBody.\n';
    const result = parseFrontmatter(content);
    assert.deepStrictEqual(result.frontmatter, ['one', 'two']);
    assert.strictEqual(result.body, 'Body.\n');
  });

  test('characterization: CRLF line endings are not recognized as front matter', () => {
    // The block regex requires a bare \n after each ---, so CRLF documents
    // currently fall through untouched. Pins current behavior (path/format
    // boundary defect surface) — revisit if the parser learns CRLF.
    const content = '---\r\ntitle: Hi\r\n---\r\nBody.\r\n';
    const result = parseFrontmatter(content);
    assert.strictEqual(result.frontmatter, null);
    assert.strictEqual(result.body, content);
    assert.strictEqual(result.linesConsumed, 0);
  });

  test('does not match a block that is not at the start of the document', () => {
    const content = '\n---\ntitle: Hi\n---\nBody.\n';
    const result = parseFrontmatter(content);
    assert.strictEqual(result.frontmatter, null);
    assert.strictEqual(result.body, content);
  });

  test('does not match a block with no closing delimiter', () => {
    const content = '---\ntitle: Hi\nBody continues.\n';
    const result = parseFrontmatter(content);
    assert.strictEqual(result.frontmatter, null);
    assert.strictEqual(result.body, content);
    assert.strictEqual(result.linesConsumed, 0);
  });
});

// Regression tests for issue #34: the frontmatter line offset must be applied
// in the token pass, not by rewriting every data-line attribute in the rendered
// HTML — which also renumbered user-authored literals and rescanned the whole
// document on every render.
suite('MarkdownEngine frontmatter line offset (#34)', () => {
  const CARD_CONFIG: PreviewConfig = {
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

  test('offsets block element data-line by the consumed frontmatter line count', () => {
    const engine = new MarkdownEngine(CARD_CONFIG);
    // '---\ntitle: T\n---\n' consumes 3 source lines; the heading is body line 0,
    // the paragraph body line 2 — so source lines are 3 and 5.
    const { html } = engine.render('---\ntitle: T\n---\n# Heading\n\nPara.\n');
    assert.ok(html.includes('<h1 data-line="3"'), `heading line not offset: ${html}`);
    assert.ok(html.includes('<p data-line="5"'), `paragraph line not offset: ${html}`);
  });

  test('offsets task-list checkbox data-line by the consumed count', () => {
    const engine = new MarkdownEngine(CARD_CONFIG);
    const { html } = engine.render('---\ntitle: T\n---\n- [ ] task\n');
    assert.ok(
      html.includes('<input type="checkbox" data-line="3"'),
      `checkbox line not offset: ${html}`
    );
  });

  test('leaves a literal data-line attribute inside a code block unchanged', () => {
    const engine = new MarkdownEngine(CARD_CONFIG);
    const doc = '---\ntitle: T\n---\n# H\n\n```\n<p data-line="12">x</p>\n```\n';
    const { html } = engine.render(doc);
    // Fence content is escaped, so the literal survives as &quot; — it must not
    // be renumbered to 15.
    assert.ok(
      html.includes('data-line=&quot;12&quot;'),
      `literal data-line in code block changed: ${html}`
    );
    assert.ok(
      !html.includes('data-line=&quot;15&quot;'),
      `escaped literal was renumbered: ${html}`
    );
  });

  test('leaves a literal data-line attribute in raw HTML unchanged', () => {
    const engine = new MarkdownEngine(CARD_CONFIG);
    // html:true passes raw HTML through verbatim; the post-render regex used to
    // rewrite this user-authored attribute to data-line="15".
    const doc = '---\ntitle: T\n---\n# H\n\n<div data-line="12">literal</div>\n';
    const { html } = engine.render(doc);
    assert.ok(html.includes('<div data-line="12">'), `literal data-line renumbered: ${html}`);
  });

  test('applies no offset when the document has no frontmatter', () => {
    const engine = new MarkdownEngine(CARD_CONFIG);
    const { html } = engine.render('# Heading\n');
    assert.ok(html.includes('data-line="0"'), `unexpected offset: ${html}`);
  });
});
