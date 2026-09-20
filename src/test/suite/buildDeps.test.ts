import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownEngine } from '../../markdownEngine';
import { PreviewConfig } from '../../types/messages';

// Build-deps wave regression pins (issues #50, #51, #52):
//   - webpack-cli must resolve to >= 7.2.3 in the lockfile (#50)
//   - css-loader must resolve to >= 7.1.5 in the lockfile (#51)
//   - style-loader and markdown-it-task-lists must be absent from both
//     package.json and package-lock.json (#52). Both were declared but
//     unused: style-loader appears in no webpack rule (the css rule is
//     [MiniCssExtractPlugin.loader, 'css-loader']), and task-list rendering
//     is a hand-rolled markdown-it core rule in src/markdownEngine.ts and
//     scripts/generate-landing.cjs — never the markdown-it-task-lists plugin.
// The render assertions prove removing the unused plugin did not regress
// checkbox markup in either engine.

const repoRoot = path.resolve(__dirname, '..', '..', '..');

const TASK_LIST_MD = '- [ ] unchecked task\n- [x] checked task\n';

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

function lockedVersion(dep: string): string | undefined {
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  return lock.packages?.[`node_modules/${dep}`]?.version as string | undefined;
}

function versionAtLeast(version: string, want: [number, number, number]): boolean {
  const got = version.split('.').map((p) => Number.parseInt(p, 10));
  for (let i = 0; i < 3; i++) {
    if ((got[i] || 0) !== want[i]) {
      return (got[i] || 0) > want[i];
    }
  }
  return true;
}

function assertTaskListCheckboxes(html: string, engineName: string): void {
  assert.ok(
    html.includes('<input type="checkbox"'),
    `${engineName}: expected <input type="checkbox"> for "- [ ]"/"- [x]", got: ${html}`
  );
  assert.ok(
    /<input type="checkbox"[^>]* checked/.test(html),
    `${engineName}: expected a checked checkbox for "- [x]", got: ${html}`
  );
}

suite('build-deps wave (#50, #51, #52)', () => {
  test('webpack-cli resolves to >= 7.2.3 (#50)', () => {
    const v = lockedVersion('webpack-cli');
    assert.ok(v, 'no lockfile entry for webpack-cli');
    assert.ok(versionAtLeast(v, [7, 2, 3]), v);
  });

  test('webpack bundles produce dist/extension.js (#50)', () => {
    // pretest runs `npm run compile`; `npm run package` is verified in CI/PR.
    const bundle = path.join(repoRoot, 'dist', 'extension.js');
    assert.ok(fs.existsSync(bundle), 'dist/extension.js missing');
    assert.ok(fs.statSync(bundle).size > 0, 'dist/extension.js is empty');
  });

  test('css-loader resolves to >= 7.1.5 (#51)', () => {
    const v = lockedVersion('css-loader');
    assert.ok(v, 'no lockfile entry for css-loader');
    assert.ok(versionAtLeast(v, [7, 1, 5]), v);
  });

  test('webpack emits a non-empty dist/webview/main.css (#51)', () => {
    const css = path.join(repoRoot, 'dist', 'webview', 'main.css');
    assert.ok(fs.existsSync(css), 'dist/webview/main.css missing');
    assert.ok(fs.statSync(css).size > 0, 'dist/webview/main.css is empty');
  });

  test('style-loader and markdown-it-task-lists are gone from both manifests (#52)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const declared = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
      ...pkg.optionalDependencies,
    };
    for (const dep of ['style-loader', 'markdown-it-task-lists']) {
      assert.ok(!(dep in declared), `${dep} still declared in package.json`);
      assert.strictEqual(
        lockedVersion(dep),
        undefined,
        `${dep} still present in package-lock.json`
      );
    }
  });

  test('preview engine renders "- [ ]"/"- [x]" as checkbox inputs (#52)', () => {
    const engine = new MarkdownEngine({ ...TEST_CONFIG });
    const { html } = engine.render(TASK_LIST_MD);
    assertTaskListCheckboxes(html, 'MarkdownEngine');
  });

  test('landing generator renders "- [ ]"/"- [x]" as checkbox inputs (#52)', () => {
    const { createMarkdownEngine } = require(
      path.join(repoRoot, 'scripts', 'generate-landing.cjs')
    ) as { createMarkdownEngine: () => { render: (s: string) => string } };
    const html = createMarkdownEngine().render(TASK_LIST_MD);
    assertTaskListCheckboxes(html, 'generate-landing.cjs');
  });
});
