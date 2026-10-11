import { test, expect } from 'vitest';
import { importJsonSchema, importOpenApi, importPrisma, importGraphql, sanitizeId } from '../src/importers.js';

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
test('prisma importer maps scalars, optional/array, and relations', () => {
  const src = `
model Student {
  id    Int      @id
  name  String
  bio   String?
  tags  String[]
  course Course
}
model Course { id Int @id }`;
  const s = importPrisma(src, 'schema').find((e) => e.id === 'Student')!;
  expect(s.schema).toMatchObject({
    type: 'object',
    properties: { id: { type: 'integer' }, name: { type: 'string' }, bio: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
  });
  expect(s.schema.required).toEqual(['id', 'name']);
  expect(s.relationships).toEqual(['Course']);
});
test('graphql importer maps object types and object-field relationships', () => {
  const src = `type Student { id: ID! name: String bio: String course: Course } type Course { id: ID! }`;
  const s = importGraphql(src, 'schema').find((e) => e.id === 'Student')!;
  expect(s.schema).toMatchObject({ type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } });
  expect(s.schema.required).toEqual(['id']);
  expect(s.relationships).toEqual(['Course']);
});
