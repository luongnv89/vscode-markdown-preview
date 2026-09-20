import * as assert from 'assert';
import { MarkdownEngine } from '../../markdownEngine';
import { PreviewConfig } from '../../types/messages';

// Engine-reuse regression tests (issue #76): the export path calls
// updateConfig() unconditionally before every export, and the config-change
// listener calls it on any markdownPreviewPro setting edit. Rebuilding the
// whole MarkdownIt pipeline — every plugin, ruler and renderer override — on
// an identical (or display-only) config was pure waste; the engine is now
// rebuilt only when a field createMarkdownIt actually consumes changes.

const BASE_CONFIG: PreviewConfig = {
  scrollSync: true,
  enableMermaid: true,
  enableKatex: true,
  enableCheckboxes: true,
  enableExcalidraw: true,
  lineBreaks: false,
  typographer: true,
  showFrontmatter: 'card',
  allowRemoteImages: false,
};

// Reach the private `md` field for an identity check — the compiled JS exposes
// it as a normal property; TypeScript only hides it at the type level.
function engineInstance(engine: MarkdownEngine): unknown {
  return (engine as unknown as { md: unknown }).md;
}

suite('engine config gating (#76)', () => {
  test('updateConfig with an identical config does not rebuild the engine', () => {
    const engine = new MarkdownEngine({ ...BASE_CONFIG });
    const before = engineInstance(engine);
    engine.updateConfig({ ...BASE_CONFIG });
    assert.strictEqual(
      engineInstance(engine),
      before,
      'updateConfig with identical config must reuse the existing engine instance'
    );
  });

  test('updateConfig twice in a row rebuilds at most once', () => {
    const engine = new MarkdownEngine({ ...BASE_CONFIG });
    engine.updateConfig({ ...BASE_CONFIG, enableKatex: false });
    const rebuilt = engineInstance(engine);
    engine.updateConfig({ ...BASE_CONFIG, enableKatex: false });
    assert.strictEqual(
      engineInstance(engine),
      rebuilt,
      'a second updateConfig with the same config must not rebuild again'
    );
  });

  test('updateConfig rebuilds when an engine option changes', () => {
    const engine = new MarkdownEngine({ ...BASE_CONFIG });
    const before = engineInstance(engine);
    engine.updateConfig({ ...BASE_CONFIG, enableMermaid: false });
    assert.notStrictEqual(
      engineInstance(engine),
      before,
      'changing an option the renderer consumes must rebuild the engine'
    );
  });

  test('display-only config changes do not rebuild but still apply', () => {
    const engine = new MarkdownEngine({ ...BASE_CONFIG });
    const before = engineInstance(engine);
    engine.updateConfig({ ...BASE_CONFIG, showFrontmatter: 'none', scrollSync: false });
    assert.strictEqual(
      engineInstance(engine),
      before,
      'display-only flags must not trigger an engine rebuild'
    );
    // The new config is still live: frontmatter rendering reads this.config.
    const { html } = engine.render('---\ntitle: T\n---\n\nbody\n');
    assert.ok(
      !html.includes('frontmatter'),
      'the updated showFrontmatter value must apply without a rebuild'
    );
  });
});
