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
    '  * jsdoc #cf222e',
    '   still a comment #9a6700 */ const b = 1;',
    "const url = 'https://x.y/#fff';",
  ].join('\n');
  const out = stripComments(src, 'ts').split('\n');
  expect(out).toHaveLength(5);
  expect(out[0]).toContain("'#1e5bff'");
  expect(out[0]).not.toContain('#0969da');
  expect(out[1]).not.toContain('#0969da');
  expect(out[2]).not.toContain('#cf222e');
  expect(out[3]).not.toContain('#9a6700');
  expect(out[3]).toContain('const b = 1;');
  expect(out[4]).toContain('https://x.y/#fff');
  const html = stripComments('<!-- #abcdef --> <div style="color:#123456"> see http://x.com #654321', 'html');
  expect(html).not.toContain('#abcdef');
  expect(html).toContain('#123456');
  expect(html).toContain('#654321');
});

test('stripComments never blanks code: regex literals, CSS urls, CSS * selectors, Dart triple strings', () => {
  expect(stripComments("p.replace(/\\/*$/, ''); const c = '#ff0000';", 'ts')).toContain('#ff0000');
  expect(stripComments("const r = /\\/\\//; const c = '#ff0000';", 'ts')).toContain('#ff0000');
  expect(stripComments('a { background: url(//cdn.x/a.png); color: #ff0000; }', 'css')).toContain('#ff0000');
  expect(stripComments('a {\n* { color: #ff0000 }\n}', 'css')).toContain('#ff0000');
  const dart = stripComments("const s = '''\nhttp://x.y\n''';\nconst c = Color(0xFFFF0000);", 'dart');
  expect(dart).toContain('Color(0xFFFF0000)');
  expect(stripComments('a { color: red; } /* #00ff00 */', 'css')).not.toContain('#00ff00');
});

test('isTestFile', () => {
  for (const f of ['a/b.test.ts', 'x.spec.tsx', 'lib/a_test.dart', 'test/widget.dart', 'web/e2e/x.ts', 'src/__tests__/a.js', 'integration_test/a.dart'])
    expect(isTestFile(f)).toBe(true);
  for (const f of ['src/latest.ts', 'lib/contest.dart', 'src/testing-utils.ts']) expect(isTestFile(f)).toBe(false);
});

test("colorIndex includes an alias's own mode values", () => {
  const M = 'com.antidrift.modes';
  const t = resolveTokenTree(
    parseTokenTree({ c: { $type: 'color', t: { $value: '#000000' }, a: { $value: '{c.t}', $extensions: { [M]: { dark: '#ABCDEF' } } } } }, 'x.json'),
  );
  expect(colorIndex(t).get('#ABCDEFFF')).toEqual(['c.a (dark)']);
});
