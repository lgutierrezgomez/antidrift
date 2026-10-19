import { test, expect } from 'vitest';
import { EMITTERS } from '../src/emitters.js';
import type { Entity } from '../src/types.js';

test('ts emitter produces an interface per entity', async () => {
  const ents: Entity[] = [
    { id: 'student', version: 1, hash: 'h', schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  ];
  const out = await EMITTERS.get('ts')!.emit(ents);
  expect(out).toMatch(/interface Student/);
  expect(out).toMatch(/name: string/);
});
test('ts emitter on empty store returns a string', async () => {
  expect(typeof (await EMITTERS.get('ts')!.emit([]))).toBe('string');
});
test('ts emitter does not resolve external file:// refs (no leak)', async () => {
  const bad: Entity[] = [{ id: 'leak', version: 1, hash: 'h', schema: { $ref: 'file:///etc/hostname' } }];
  await expect((async () => EMITTERS.get('ts')!.emit(bad))()).rejects.toThrow();
});
test('ts emitter ignores code-emitting keywords (tsType) in schemas', async () => {
  const ents: Entity[] = [
    { id: 'x', version: 1, hash: 'h', schema: { type: 'object', properties: { f: { tsType: 'InjectedEvil' } } } },
  ];
  const out = await EMITTERS.get('ts')!.emit(ents);
  expect(out).not.toContain('InjectedEvil');
});
test('enum emitter writes as-const arrays for every enum, nested and in arrays', () => {
  const ents: Entity[] = [
    {
      id: 'place', version: 1, hash: 'h',
      schema: {
        type: 'object',
        properties: {
          placeType: { type: 'string', enum: ['restaurant', 'bar'] },
          foodTypes: { type: 'array', items: { enum: ['sushi', 'pizza'] } },
          address: { type: 'object', properties: { kind: { enum: ['home', 'work'] } } },
          name: { type: 'string' },
        },
      },
    },
  ];
  const out = EMITTERS.get('ts')!.emitEnums!(ents);
  expect(out).toContain('export const PLACE_PLACE_TYPE = ["restaurant","bar"] as const;');
  expect(out).toContain('export type PlacePlaceType = (typeof PLACE_PLACE_TYPE)[number];');
  expect(out).toContain('export const PLACE_FOOD_TYPES = ["sushi","pizza"] as const;');
  expect(out).toContain('export const PLACE_ADDRESS_KIND = ["home","work"] as const;');
  expect(out).not.toContain('NAME');
});
test('enum emitter cannot be used to inject code via property names or values', () => {
  const ents: Entity[] = [
    { id: 'x', version: 1, hash: 'h', schema: { type: 'object', properties: { 'a;evil()//': { enum: ['"];evil();//'] } } } },
  ];
  const out = EMITTERS.get('ts')!.emitEnums!(ents);
  expect(out).toContain('export const X_A_EVIL = ["\\"];evil();//"] as const;');
});
