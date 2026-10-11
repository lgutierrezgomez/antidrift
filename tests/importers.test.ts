import { test, expect } from 'vitest';
import { importJsonSchema, sanitizeId } from '../src/importers.js';

test('sanitizeId coerces illegal chars', () => {
  expect(sanitizeId('User Role!')).toBe('User-Role-');
});
test('json-schema importer: one entity per $defs entry', () => {
  const src = JSON.stringify({ $defs: { Student: { type: 'object', properties: { name: { type: 'string' } } } } });
  const ents = importJsonSchema(src, 'file');
  expect(ents.map((e) => e.id)).toEqual(['Student']);
  expect(ents[0].version).toBe(1);
  expect(ents[0].hash).toBe('');
});
test('json-schema importer: whole-doc fallback uses the file name', () => {
  expect(importJsonSchema(JSON.stringify({ type: 'object' }), 'student')[0].id).toBe('student');
});
