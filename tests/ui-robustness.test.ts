import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S from '../src/store.js';
import { cmdList, cmdScan, cmdShow, cmdNotify } from '../src/cli.js';
import { componentsDir, readComponent } from '../src/ui/components.js';
import { tokensDir } from '../src/ui/tokens.js';

let root: string;
const comp = (name: string, content: string) => {
  mkdirSync(componentsDir(root), { recursive: true });
  writeFileSync(join(componentsDir(root), `${name}.json`), content);
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ad-robust-'));
  S.writeEntity(root, { id: 'student', version: 1, hash: 'x', schema: { type: 'object' } });
  writeFileSync(join(root, 'app.ts'), '// antidrift #student@1\n');
});

test('a component with invalid JSON does not break entity commands and is reported by scan', () => {
  comp('broken', '{bad');
  expect(cmdList(root)).toContain('#student@1');
  expect(cmdShow(root, 'student')).toContain('#student@1');
  expect(cmdNotify(root, 'student')).toContain('#student');
  const r = cmdScan(root);
  expect(r.report).toContain('components/broken.json');
  expect(r.report).toContain('[invalid-component]');
  expect(r.ui!.problems.map((p) => p.kind)).toEqual(['invalid-component']);
});

test('readComponent names the file on invalid JSON', () => {
  comp('broken', '{bad');
  expect(() => readComponent(root, 'broken')).toThrow(/components\/broken\.json/);
});

test('a component missing fields is reported, not crashed on', () => {
  comp('nofields', JSON.stringify({ id: 'nofields', version: 1, hash: '' }));
  writeFileSync(join(root, 'use.ts'), '// antidrift use #nofields:x\n');
  const r = cmdScan(root);
  expect(r.report).toMatch(/components\/nofields\.json.*\[invalid-component\]/);
  expect(() => cmdShow(root, 'nofields')).toThrow(/nofields/);
  expect(cmdList(root)).not.toContain('undefined');
});

test('a component whose id differs from its file name is reported and never duplicated', () => {
  comp('broken', JSON.stringify({
    id: 'other', version: 1, hash: '', variants: ['primary'], states: ['default'],
    styles: { primary: { default: {} } },
  }));
  expect(cmdScan(root).report).toMatch(/components\/broken\.json.*id "other".*\[invalid-component\]/);
  expect(() => cmdNotify(root, 'broken')).toThrow(/other/);
  expect(existsSync(join(componentsDir(root), 'other.json'))).toBe(false);
});

test('an invalid token file is a scan problem; entity drift is still reported', () => {
  mkdirSync(tokensDir(root), { recursive: true });
  writeFileSync(join(tokensDir(root), 'color.json'), '{ nope');
  writeFileSync(join(root, 'old.ts'), '// antidrift #student@0\n');
  const r = cmdScan(root);
  expect(r.report).toContain('old.ts:1  #student@0 -> stale');
  expect(r.report).toMatch(/color\.json.*\[invalid-tokens\]/);
  expect(cmdList(root)).toContain('#student@1');
  expect(cmdList(root)).toMatch(/tokens: invalid — color\.json/);
});
