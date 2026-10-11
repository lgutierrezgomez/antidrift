import { test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
