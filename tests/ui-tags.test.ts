import { test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseUiTags } from '../src/ui/tags.js';
import { parseTags, walkFiles } from '../src/scanner.js';

test('parseUiTags reads impl and use tags', () => {
  const src = [
    '// antidrift impl #pagar_button@3',
    'x',
    '<!-- antidrift use #pagar_button:primary -->',
    '// antidrift use #pagar_button',
  ].join('\n');
  const { impls, uses } = parseUiTags(src, 'a.tsx');
  expect(impls).toEqual([{ id: 'pagar_button', version: 3, file: 'a.tsx', line: 1 }]);
  expect(uses).toEqual([
    { id: 'pagar_button', variant: 'primary', file: 'a.tsx', line: 3 },
    { id: 'pagar_button', file: 'a.tsx', line: 4 },
  ]);
});

test('entity parseTags ignores impl/use tags', () => {
  expect(parseTags('// antidrift impl #pagar_button@3\n// antidrift use #pagar_button:primary')).toEqual([]);
});

test('walkFiles honors skip and the default ignores', () => {
  const root = mkdtempSync(join(tmpdir(), 'ad-walk-'));
  mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'build'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'x', 'a.ts'), '');
  writeFileSync(join(root, 'src', 'a.ts'), '');
  writeFileSync(join(root, 'build', 'b.ts'), '');
  const all = [...walkFiles(root)].map((f) => f.rel).sort();
  expect(all).toEqual(['build/b.ts', 'src/a.ts']);
  const skipped = [...walkFiles(root, (rel, isDir) => isDir && rel === 'build')].map((f) => f.rel);
  expect(skipped).toEqual(['src/a.ts']);
});
