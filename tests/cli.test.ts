import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S from '../src/store.js';
import { cmdList, cmdScan, cmdNotify } from '../src/cli.js';
import type { Entity } from '../src/types.js';

let root: string;
const schema = { type: 'object', properties: { name: { type: 'string' } } };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ad-'));
  const e: Entity = { id: 'student', version: 1, hash: S.computeHash(schema), schema, title: 'Student', summary: 'a learner' };
  S.writeEntity(root, e);
  S.buildIndex(root);
});

test('cmdList shows the entity', () => {
  expect(cmdList(root)).toContain('#student@1');
});
test('cmdScan reports stale usage', () => {
  writeFileSync(join(root, 'a.ts'), '// antidrift #student@0\n');
  const e = S.readEntity(root, 'student');
  e.schema = { ...schema, extra: { type: 'string' } };
  S.writeEntity(root, e);
  S.reconcileEntity(root, 'student');
  S.buildIndex(root);
  const { problems } = cmdScan(root);
  expect(problems[0].status).toBe('stale');
});
test('cmdNotify bumps and reports stale sites', () => {
  writeFileSync(join(root, 'a.ts'), '// antidrift #student@1\n');
  const e = S.readEntity(root, 'student');
  e.schema = { ...schema, extra: { type: 'string' } };
  S.writeEntity(root, e);
  const msg = cmdNotify(root, 'student');
  expect(msg).toContain('STALE');
  expect(msg).toContain('a.ts:1');
});
