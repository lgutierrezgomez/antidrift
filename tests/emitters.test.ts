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
