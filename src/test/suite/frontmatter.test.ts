import * as assert from 'assert';
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
