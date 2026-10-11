import { test, expect } from 'vitest';
import { computeDrift, problems } from '../src/drift.js';
import type { IndexEntry, UsageTag } from '../src/types.js';

const idx: IndexEntry[] = [{ id: 'student', title: 'S', version: 4, hash: 'h', summary: '', file: 'entities/student.json' }];
const tag = (id: string, version: number): UsageTag => ({ id, version, file: 'a.ts', line: 1 });

test('stale when tag version is behind', () => {
  expect(computeDrift([tag('student', 3)], idx)[0].status).toBe('stale');
});
test('ok when tag version matches', () => {
  expect(computeDrift([tag('student', 4)], idx)[0].status).toBe('ok');
});
test('orphan when entity id unknown', () => {
  const d = computeDrift([tag('ghost', 1)], idx)[0];
  expect(d.status).toBe('orphan');
  expect(d.currentVersion).toBeNull();
});
test('problems filters out ok', () => {
  const items = computeDrift([tag('student', 4), tag('student', 3), tag('ghost', 1)], idx);
  expect(problems(items).map((i) => i.status)).toEqual(['stale', 'orphan']);
});
