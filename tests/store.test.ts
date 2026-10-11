import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S from '../src/store.js';
import type { Entity } from '../src/types.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ad-')); });
const ent = (over: Partial<Entity> = {}): Entity =>
  ({ id: 'student', version: 1, hash: '', schema: { type: 'object', properties: { name: { type: 'string' } } }, ...over });

test('computeHash is stable regardless of key order', () => {
  expect(S.computeHash({ a: 1, b: 2 })).toBe(S.computeHash({ b: 2, a: 1 }));
});
test('writeEntity rejects invalid JSON Schema', () => {
  expect(() => S.writeEntity(root, ent({ schema: { type: 'not-a-type' } }))).toThrow();
});
test('reconcile is idempotent when schema unchanged', () => {
  const e = ent({ hash: S.computeHash(ent().schema) });
  S.writeEntity(root, e);
  expect(S.reconcileEntity(root, 'student').version).toBe(1);
});
test('reconcile bumps version when schema changed', () => {
  S.writeEntity(root, ent({ hash: 'stale-hash' }));
  expect(S.reconcileEntity(root, 'student').version).toBe(2);
});
test('reconcile stamps hash without bumping on first reconcile (empty hash)', () => {
  S.writeEntity(root, ent({ hash: '' }));
  const e = S.reconcileEntity(root, 'student');
  expect(e.version).toBe(1);
  expect(e.hash).toBe(S.computeHash(ent().schema));
});
test('buildIndex lists all entities', () => {
  S.writeEntity(root, ent({ hash: S.computeHash(ent().schema), title: 'Student', summary: 'a learner' }));
  const idx = S.buildIndex(root);
  expect(idx).toEqual([{ id: 'student', title: 'Student', version: 1, hash: S.computeHash(ent().schema), summary: 'a learner', file: 'entities/student.json' }]);
});
test('buildIndex returns empty without throwing when no store exists', () => {
  expect(S.buildIndex(root)).toEqual([]);
});
test('computeIndex returns entries without writing index.json', () => {
  S.writeEntity(root, ent({ hash: S.computeHash(ent().schema) }));
  const idx = S.computeIndex(root);
  expect(idx.map((e) => e.id)).toEqual(['student']);
  expect(existsSync(S.indexPath(root))).toBe(false);
});
test('entityPath rejects empty and path-traversal ids', () => {
  expect(() => S.entityPath(root, '')).toThrow();
  expect(() => S.entityPath(root, '../evil')).toThrow();
  expect(() => S.entityPath(root, 'student')).not.toThrow();
});
