import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S from '../src/store.js';
import { computeDerivedDrift } from '../src/relationships.js';
import { cmdScan, cmdNotify, cmdShow } from '../src/cli.js';
import type { Entity } from '../src/types.js';

const ent = (id: string, version: number, derivedFrom?: Record<string, number>): Entity => ({
  id, version, hash: 'h', schema: {}, ...(derivedFrom ? { derivedFrom } : {}),
});

test('derived entity is ok when its base version matches', () => {
  const ents = [ent('place', 1), ent('nearbyPlace', 1, { place: 1 })];
  expect(computeDerivedDrift(ents, new Map([['place', 1], ['nearbyPlace', 1]]))).toEqual([]);
});
test('derived entity is stale when its base moved on', () => {
  const ents = [ent('place', 2), ent('nearbyPlace', 1, { place: 1 })];
  expect(computeDerivedDrift(ents, new Map([['place', 2], ['nearbyPlace', 1]]))).toEqual([
    { entity: 'nearbyPlace', base: 'place', builtOn: 1, currentVersion: 2, status: 'stale' },
  ]);
});
test('derived entity whose base is missing is an orphan', () => {
  expect(computeDerivedDrift([ent('nearbyPlace', 1, { ghost: 1 })], new Map([['nearbyPlace', 1]]))).toEqual([
    { entity: 'nearbyPlace', base: 'ghost', builtOn: 1, currentVersion: null, status: 'orphan' },
  ]);
});

let root: string;
const placeSchema = { type: 'object', properties: { name: { type: 'string' } } };
const nearbySchema = { type: 'object', properties: { name: { type: 'string' }, distance: { type: 'number' } } };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ad-derived-'));
  S.writeEntity(root, { id: 'place', version: 1, hash: S.computeHash(placeSchema), schema: placeSchema });
  S.writeEntity(root, { id: 'nearbyPlace', version: 1, hash: S.computeHash(nearbySchema), schema: nearbySchema, derivedFrom: { place: 1 } });
  S.buildIndex(root);
});
const changePlace = () => {
  const p = S.readEntity(root, 'place');
  p.schema = { ...placeSchema, properties: { ...placeSchema.properties, slug: { type: 'string' } } };
  S.writeEntity(root, p);
};

test('scan flags a projection whose base changed, and fails', () => {
  changePlace();
  S.reconcileEntity(root, 'place');
  const r = cmdScan(root);
  expect(r.derived).toHaveLength(1);
  expect(r.report).toContain('#nearbyPlace derived from #place@1 -> stale (current @2)');
});
test('notify on a base change names the stale projections', () => {
  changePlace();
  const msg = cmdNotify(root, 'place');
  expect(msg).toContain('#nearbyPlace');
  expect(msg).toContain('derivedFrom');
});
test('bumping derivedFrom does not bump the projection version', () => {
  const n = S.readEntity(root, 'nearbyPlace');
  n.derivedFrom = { place: 2 };
  S.writeEntity(root, n);
  expect(S.reconcileEntity(root, 'nearbyPlace').version).toBe(1);
});
test('show lists derivedFrom and projections in both directions', () => {
  expect(cmdShow(root, 'nearbyPlace')).toMatch(/Derived from:\n  #place@1/);
  expect(cmdShow(root, 'place')).toMatch(/Projections:\n  #nearbyPlace/);
});
