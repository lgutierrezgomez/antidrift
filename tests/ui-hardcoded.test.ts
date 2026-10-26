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
