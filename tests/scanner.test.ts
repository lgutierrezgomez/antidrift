import { test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTags, scanRepo } from '../src/scanner.js';

test('parses tags in any comment syntax', () => {
  const c = ['// antidrift #student@3', '# antidrift #course@1', '<!-- antidrift #teacher@2 -->'].join('\n');
  expect(parseTags(c)).toEqual([
    { id: 'student', version: 3, line: 1 },
    { id: 'course', version: 1, line: 2 },
    { id: 'teacher', version: 2, line: 3 },
  ]);
});
test('scanRepo finds tags and skips node_modules and .antidrift', () => {
  const root = mkdtempSync(join(tmpdir(), 'ad-'));
  writeFileSync(join(root, 'a.ts'), '// antidrift #student@3\n');
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'node_modules', 'b.ts'), '// antidrift #x@1\n');
  mkdirSync(join(root, '.antidrift'));
  writeFileSync(join(root, '.antidrift', 'c.json'), 'antidrift #y@1');
  const tags = scanRepo(root);
  expect(tags).toEqual([{ id: 'student', version: 3, file: 'a.ts', line: 1 }]);
});
test('scanRepo also skips .git and dist', () => {
  const root = mkdtempSync(join(tmpdir(), 'ad-'));
  writeFileSync(join(root, 'keep.ts'), '// antidrift #real@1\n');
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, '.git', 'g.ts'), '// antidrift #git@1\n');
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist', 'd.ts'), '// antidrift #dist@1\n');
  expect(scanRepo(root).map((t) => t.id)).toEqual(['real']);
});
test('scanRepo does not follow symlinks and skips >2MB files', () => {
  const root = mkdtempSync(join(tmpdir(), 'ad-'));
  writeFileSync(join(root, 'ok.ts'), '// antidrift #a@1\n');
  writeFileSync(join(root, 'big.ts'), '// antidrift #big@1\n' + 'x'.repeat(2 * 1024 * 1024 + 1));
  writeFileSync(join(root, 'real.ts'), '// antidrift #link@1\n');
  symlinkSync(join(root, 'real.ts'), join(root, 'link.ts'));
  expect(scanRepo(root).map((t) => t.id).sort()).toEqual(['a', 'link']);
});

test('scanRepo skips build output folders that copy source comments (.next, build, .dart_tool…)', () => {
  const root = mkdtempSync(join(tmpdir(), 'ad-build-'));
  for (const d of ['.next/server', 'build/web', '.dart_tool/x', 'out', '.svelte-kit', '.nuxt', 'coverage', 'src'])
    mkdirSync(join(root, d), { recursive: true });
  for (const d of ['.next/server', 'build/web', '.dart_tool/x', 'out', '.svelte-kit', '.nuxt', 'coverage', 'src'])
    writeFileSync(join(root, d, 'a.js'), '// antidrift #student@1\n');
  expect(scanRepo(root).map((t) => t.file)).toEqual([join('src', 'a.js')]);
});
