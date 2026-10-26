import { test, expect } from 'vitest';
import { parseTokenTree, resolveTokenTree } from '../src/ui/tokens.js';
import { findColorLiterals, colorIndex, isGeneratedFile, UI_EXTENSIONS, BUILD_SKIP_DIRS } from '../src/ui/hardcoded.js';

test('findColorLiterals normalizes all forms', () => {
  const line = "a: #1e5bff; b: #1E5BFF80; c: #fff; Color(0xFF1E5BFF); rgb(30, 91, 255); rgba(30,91,255,0.5)";
  expect(findColorLiterals(line).map((l) => l.hex)).toEqual([
    '#1E5BFFFF',
    '#1E5BFF80',
    '#FFFFFFFF',
    '#1E5BFFFF',
    '#1E5BFFFF',
    '#1E5BFF80',
  ]);
  expect(findColorLiterals('  color: #1e5bff;')[0]).toEqual({ raw: '#1e5bff', hex: '#1E5BFFFF', column: 10 });
});

test('findColorLiterals ignores html entities and longer words', () => {
  expect(findColorLiterals('&#123; #12345 abc#fff #1234567 #abcdefg')).toEqual([]);
});

test('colorIndex excludes aliases', () => {
  const tokens = resolveTokenTree(
    parseTokenTree({ color: { $type: 'color', a: { $value: '#1E5BFF' }, b: { $value: '{color.a}' }, c: { $value: '#1E5BFF' } } }, 'x.json'),
  );
  expect(colorIndex(tokens).get('#1E5BFFFF')).toEqual(['color.a', 'color.c']);
});

test('isGeneratedFile and skip sets', () => {
  expect(isGeneratedFile('lib/a.g.dart')).toBe(true);
  expect(isGeneratedFile('x.freezed.dart')).toBe(true);
  expect(isGeneratedFile('web/app.min.js')).toBe(true);
  expect(isGeneratedFile('lib/app.dart')).toBe(false);
  expect(UI_EXTENSIONS.has('dart')).toBe(true);
  expect(UI_EXTENSIONS.has('md')).toBe(false);
  expect(BUILD_SKIP_DIRS.has('.dart_tool')).toBe(true);
});

import { stripComments, isTestFile } from '../src/ui/hardcoded.js';

test('stripComments blanks line, block and html comments but keeps line count and code', () => {
  const src = [
    "const a = '#1e5bff'; // was #0969da",
    '/* primary #0969da',
    '   still a comment #9a6700 */ const b = 1;',
    '  * jsdoc #cf222e',
    "const url = 'https://x.y/#fff';",
    '<!-- #abcdef --> <div style="color:#123456">',
  ].join('\n');
  const out = stripComments(src).split('\n');
  expect(out).toHaveLength(6);
  expect(out[0]).toContain("'#1e5bff'");
  expect(out[0]).not.toContain('#0969da');
  expect(out[1]).not.toContain('#0969da');
  expect(out[2]).not.toContain('#9a6700');
  expect(out[2]).toContain('const b = 1;');
  expect(out[3]).not.toContain('#cf222e');
  expect(out[4]).toContain('https://x.y/#fff');
  expect(out[5]).not.toContain('#abcdef');
  expect(out[5]).toContain('#123456');
});

test('isTestFile', () => {
  for (const f of ['a/b.test.ts', 'x.spec.tsx', 'lib/a_test.dart', 'test/widget.dart', 'web/e2e/x.ts', 'src/__tests__/a.js', 'integration_test/a.dart'])
    expect(isTestFile(f)).toBe(true);
  for (const f of ['src/latest.ts', 'lib/contest.dart', 'src/testing-utils.ts']) expect(isTestFile(f)).toBe(false);
});
