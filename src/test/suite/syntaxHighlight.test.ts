import * as assert from 'assert';
import { MarkdownEngine } from '../../markdownEngine';
import { PreviewConfig } from '../../types/messages';

// Bundle-slimming regression tests (issue #73): the engine must keep
// highlighting the common-language subset registered through
// highlight.js/lib/core + src/hljsLanguages.ts after the bare `highlight.js`
// import (which pulled every bundled grammar into dist/extension.js) was
// dropped. A fence in an unregistered language falls back to the escaped
// plain code block the auto-detect path already produced.

const TEST_CONFIG: PreviewConfig = {
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

const ENGINE = () => new MarkdownEngine({ ...TEST_CONFIG });

function renderFence(lang: string, code: string): string {
  return ENGINE().render('```' + lang + '\n' + code + '\n```').html;
}

suite('syntax highlighting language subset (#73)', () => {
  const highlighted: Array<{ lang: string; code: string; token: string }> = [
    { lang: 'typescript', code: 'const x: number = 1;', token: 'hljs-keyword' },
    { lang: 'python', code: 'def f():\n    return 1', token: 'hljs-' },
    { lang: 'json', code: '{"key": 1}', token: 'hljs-attr' },
    { lang: 'bash', code: 'echo "hi"', token: 'hljs-' },
    { lang: 'diff', code: '+added\n-removed', token: 'hljs-addition' },
  ];

  for (const { lang, code, token } of highlighted) {
    test(`fenced ${lang} code is still highlighted`, () => {
      const html = renderFence(lang, code);
      assert.ok(
        html.includes(`<pre class="hljs code-block" data-lang="${lang}">`),
        `no highlighted block for ${lang}: ${html}`
      );
      assert.ok(
        new RegExp(`<span class="${token.replace(/-/g, '\\-')}`).test(html),
        `no ${token}* span for ${lang}: ${html}`
      );
    });
  }

  test('an unregistered language falls back to a plain code block', () => {
    const html = renderFence('coffeescript', 'x = 1');
    assert.ok(
      html.includes('<pre class="hljs code-block"><code>'),
      `expected plain code block, got: ${html}`
    );
    assert.ok(!html.includes('data-lang='), `unregistered lang kept data-lang: ${html}`);
  });

  test('a common alias resolves to its registered language', () => {
    const html = renderFence('js', 'const x = 1;');
    assert.ok(
      html.includes('data-lang="js"'),
      `alias js not resolved to javascript grammar: ${html}`
    );
    assert.ok(html.includes('hljs-keyword'), `alias js produced no highlight spans: ${html}`);
  });
});
