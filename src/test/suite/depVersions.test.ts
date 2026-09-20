import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';

// Dependency-major regression pins (issues #45, #46, #47): the lockfile must
// resolve each production dependency to the bumped major — the same check as
// the issues' Verify commands:
//   node -p "require('./package-lock.json').packages['node_modules/<dep>'].version"

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function lockedVersion(dep: string): string {
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  const entry = lock.packages?.[`node_modules/${dep}`];
  assert.ok(entry?.version, `no lockfile entry for ${dep}`);
  return entry.version as string;
}

function major(version: string): number {
  const m = version.match(/^(\d+)\./);
  assert.ok(m, `unparsable version: ${version}`);
  return Number(m[1]);
}

suite('production dependency majors (#45, #46, #47)', () => {
  test('mermaid resolves to >= 12.0.0 (#45)', () => {
    assert.ok(major(lockedVersion('mermaid')) >= 12, lockedVersion('mermaid'));
  });

  test('markdown-it resolves to >= 15.0.2 (#46)', () => {
    const v = lockedVersion('markdown-it');
    assert.ok(major(v) >= 15, v);
  });

  test('katex resolves to >= 0.18.7 (#47)', () => {
    const v = lockedVersion('katex');
    const [maj, min] = v.split('.').map(Number);
    assert.ok(maj > 0 || min >= 18, v);
  });

  test('@types/markdown-it is gone — v15 bundles its own declarations', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    assert.ok(!pkg.devDependencies?.['@types/markdown-it'], '@types/markdown-it still declared');
  });
});
