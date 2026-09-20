import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownEngine } from '../../markdownEngine';
import { PreviewConfig } from '../../types/messages';

// Golden-output regression test (issue #46): the rendered HTML for a fixture
// exercising task lists, inline/block math, tables and a fenced mermaid
// diagram must match the output recorded under markdown-it 14.x before the
// 15.x major bump. Regenerate the golden only deliberately:
//   GOLDEN_UPDATE=1 npm test
// A diff here means the parser upgrade changed our emitted markup — inspect
// whether the change is a legitimate upstream rendering change before
// regenerating.

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const fixturePath = path.join(repoRoot, 'src', 'test', 'fixtures', 'golden-render.md');
const goldenPath = path.join(repoRoot, 'src', 'test', 'fixtures', 'golden-render.html');

const GOLDEN_CONFIG: PreviewConfig = {
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

suite('MarkdownEngine golden output (#46)', () => {
  test('fixture render matches the recorded pre-bump output', () => {
    const engine = new MarkdownEngine({ ...GOLDEN_CONFIG });
    const markdown = fs.readFileSync(fixturePath, 'utf8');
    const { html } = engine.render(markdown);

    if (process.env.GOLDEN_UPDATE === '1') {
      fs.writeFileSync(goldenPath, html);
      assert.fail(`golden regenerated at ${goldenPath} — re-run without GOLDEN_UPDATE`);
    }

    assert.ok(fs.existsSync(goldenPath), `golden file missing: ${goldenPath}`);
    const golden = fs.readFileSync(goldenPath, 'utf8');
    assert.strictEqual(
      html,
      golden,
      'rendered output diverged from the golden fixture — inspect the diff, ' +
        'then regenerate deliberately with GOLDEN_UPDATE=1 npm test'
    );
  });
});
