import { test, expect } from 'vitest';
import { importJsonSchema, importOpenApi, sanitizeId } from '../src/importers.js';

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
test('openapi importer maps components.schemas and captures $ref relationships', () => {
  const src = `
openapi: 3.0.0
components:
  schemas:
    Student:
      type: object
      properties:
        course: { $ref: '#/components/schemas/Course' }
    Course:
      type: object
      properties:
        title: { type: string }`;
  const ents = importOpenApi(src, 'api');
  const student = ents.find((e) => e.id === 'Student')!;
  expect(ents.map((e) => e.id).sort()).toEqual(['Course', 'Student']);
  expect(student.relationships).toEqual(['Course']);
});
