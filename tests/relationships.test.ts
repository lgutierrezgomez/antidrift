import { test, expect } from 'vitest';
import { computeBrokenRefs } from '../src/relationships.js';
import type { Entity } from '../src/types.js';

const e = (id: string, rels: string[]): Entity => ({ id, version: 1, hash: 'h', schema: {}, relationships: rels });

test('flags relationship ids not in the store', () => {
  const known = new Set(['student', 'course']);
  expect(computeBrokenRefs([e('student', ['course', 'ghost'])], known)).toEqual([{ entity: 'student', ref: 'ghost' }]);
});
test('no relationships = no broken refs', () => {
  expect(computeBrokenRefs([e('student', [])], new Set(['student']))).toEqual([]);
});
