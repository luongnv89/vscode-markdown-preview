import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as acorn from 'acorn';

// Structural regression pin (issue #60, F-CLEAN-001): no function in
// scripts/generate-landing.cjs may exceed 50 lines. The build script's
// oversized functions (buildHtml was 248, getCombinedCss 67) were split into
// named helpers plus module constants for the static template blocks; this
// test is the line-count check the acceptance criterion calls for, so the
// ceiling cannot silently regress.
// acorn parses the file for real: the giant page-template strings are
// TemplateLiteral nodes, so the client-side functions inside them are string
// content and never counted as functions of this file.

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const landingScriptPath = path.join(repoRoot, 'scripts', 'generate-landing.cjs');
const MAX_FUNCTION_LINES = 50;

interface FunctionSpan {
  name: string;
  startLine: number;
  endLine: number;
}

// Walks the acorn AST collecting every declared/expressed function's line span
// (signature line through closing brace, inclusive).
function collectFunctionSpans(source: string): FunctionSpan[] {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', locations: true });
  const spans: FunctionSpan[] = [];
  const visit = (node: acorn.Node & Record<string, unknown>): void => {
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      const fn = node as unknown as acorn.Function & { loc: acorn.SourceLocation };
      spans.push({
        name: fn.id?.name ?? '<anonymous>',
        startLine: fn.loc.start.line,
        endLine: fn.loc.end.line,
      });
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach((c) => {
          if (c && typeof c.type === 'string') visit(c);
        });
      } else if (child && typeof (child as acorn.Node).type === 'string') {
        visit(child as acorn.Node & Record<string, unknown>);
      }
    }
  };
  visit(ast as unknown as acorn.Node & Record<string, unknown>);
  return spans;
}

suite('generate-landing structure (#60)', () => {
  test('no function exceeds 50 lines', () => {
    const source = fs.readFileSync(landingScriptPath, 'utf8');
    const spans = collectFunctionSpans(source);
    assert.ok(spans.length > 0, 'expected to find functions in generate-landing.cjs');
    const oversized = spans.filter((s) => s.endLine - s.startLine + 1 > MAX_FUNCTION_LINES);
    assert.deepStrictEqual(
      oversized.map((s) => `${s.name}: ${s.endLine - s.startLine + 1} lines @L${s.startLine}`),
      [],
      `functions exceeding ${MAX_FUNCTION_LINES} lines found in generate-landing.cjs`
    );
  });
});
