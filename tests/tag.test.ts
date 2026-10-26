import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S from '../src/store.js';
import { cmdTag } from '../src/cli.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ad-'));
  S.writeEntity(root, { id: 'student', version: 3, hash: 'h', schema: { type: 'object' } });
  S.buildIndex(root);
});

test('tag inserts a // comment above the line in a .ts file', () => {
  writeFileSync(join(root, 'a.ts'), 'const x = 1;\nuseStudent();\n');
  cmdTag(root, 'student', join(root, 'a.ts') + ':2');
  expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('const x = 1;\n// antidrift #student@3\nuseStudent();\n');
});

test('tag uses # for .py and errors on an out-of-range line', () => {
  writeFileSync(join(root, 'b.py'), 'use_student()\n');
  cmdTag(root, 'student', join(root, 'b.py') + ':1');
  expect(readFileSync(join(root, 'b.py'), 'utf8')).toBe('# antidrift #student@3\nuse_student()\n');
  expect(() => cmdTag(root, 'student', join(root, 'b.py') + ':99')).toThrow();
});

test('tag without a :line explains the expected form', () => {
  writeFileSync(join(root, 'c.ts'), 'x\n');
  expect(() => cmdTag(root, 'student', join(root, 'c.ts'))).toThrow(/<file:line>/);
  expect(() => cmdTag(root, 'student', join(root, 'c.ts') + ':abc')).toThrow(/<file:line>/);
});
