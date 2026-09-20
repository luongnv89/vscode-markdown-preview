import * as assert from 'assert';
import * as path from 'path';
import { MarkdownEngine } from '../../markdownEngine';
import { PreviewConfig } from '../../types/messages';

// Shared-engine parity tests (issue #54): scripts/generate-landing.cjs renders
// through the compiled dist/markdownCore.js — the same pipeline MarkdownEngine
// delegates to — so a fence the extension turns into a diagram block can never
// again fall back to a plain code block on the website. These tests pin
// byte-identical output between the extension engine and the generator's
// renderer for the constructs that had already diverged (excalidraw) or are
// structurally shared (mermaid, task lists).

const repoRoot = path.resolve(__dirname, '..', '..', '..');

// Mirrors the generator's LANDING_CONFIG (PreviewConfig-equivalent flags):
// typographer on, hard breaks off, every renderer feature on.
const PARITY_CONFIG: PreviewConfig = {
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

const EXCALIDRAW_MD = [
  '```excalidraw',
  '{"type":"excalidraw","version":2,"source":"test","elements":[],"appState":{}}',
  '```',
  '',
].join('\n');

const MERMAID_MD = ['```mermaid', 'graph TD', '  A --> B', '```', ''].join('\n');

const TASK_LIST_MD = '- [ ] unchecked task\n- [x] checked task\n';

function landingRender(markdown: string): string {
  const { createLandingRenderer } = require(
    path.join(repoRoot, 'scripts', 'generate-landing.cjs')
  ) as { createLandingRenderer: () => { render: (s: string) => string } };
  return createLandingRenderer().render(markdown);
}

suite('shared engine parity (#54)', () => {
  test('excalidraw fence renders identically through engine and generator', () => {
    const { html } = new MarkdownEngine({ ...PARITY_CONFIG }).render(EXCALIDRAW_MD);
    assert.strictEqual(landingRender(EXCALIDRAW_MD), html);
    assert.ok(
      html.includes('excalidraw-block'),
      `expected an excalidraw-block diagram container, got: ${html}`
    );
  });

  test('mermaid fence renders identically through engine and generator', () => {
    const { html } = new MarkdownEngine({ ...PARITY_CONFIG }).render(MERMAID_MD);
    assert.strictEqual(landingRender(MERMAID_MD), html);
    assert.ok(
      html.includes('mermaid-block'),
      `expected a mermaid-block diagram container, got: ${html}`
    );
  });

  test('task list renders identically through engine and generator', () => {
    const { html } = new MarkdownEngine({ ...PARITY_CONFIG }).render(TASK_LIST_MD);
    assert.strictEqual(landingRender(TASK_LIST_MD), html);
  });
});
