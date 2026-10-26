import { test, expect } from 'vitest';
import { importJsonSchema, importOpenApi, importPrisma, importGraphql, sanitizeId } from '../src/importers.js';
import { computeHash } from '../src/store.js';

test('sanitizeId coerces illegal chars', () => {
  expect(sanitizeId('User Role!')).toBe('User-Role-');
});
test('json-schema importer: one entity per $defs entry', () => {
  const src = JSON.stringify({ $defs: { Student: { type: 'object', properties: { name: { type: 'string' } } } } });
  const ents = importJsonSchema(src, 'file');
  expect(ents.map((e) => e.id)).toEqual(['Student']);
  expect(ents[0].version).toBe(1);
  expect(ents[0].hash).toBe(computeHash(ents[0].schema));
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
test('importers strip $refs from stored schemas but keep relationships', () => {
  const src = `
openapi: 3.0.0
components:
  schemas:
    Student:
      type: object
      properties:
        course: { $ref: '#/components/schemas/Course' }
    Course:
      type: object`;
  const student = importOpenApi(src, 'api').find((e) => e.id === 'Student')!;
  expect(JSON.stringify(student.schema)).not.toContain('$ref');
  expect(student.relationships).toEqual(['Course']);
});
test('importJsonSchema throws on malformed input', () => {
  expect(() => importJsonSchema('not json at all', 'x')).toThrow();
});
test('prisma importer maps enums to JSON Schema enum and notes unsupported fields', () => {
  const src = `
enum Level {
  BEGINNER
  ADVANCED @map("adv")
  @@map("levels")
}
model Student {
  id    Int     @id
  level Level
  tags  Level[]
  geo   Unsupported("geometry")?
}`;
  const notes: string[] = [];
  const s = importPrisma(src, 'schema', notes).find((e) => e.id === 'Student')!;
  expect(s.schema.properties).toMatchObject({
    level: { enum: ['BEGINNER', 'ADVANCED'] },
    tags: { type: 'array', items: { enum: ['BEGINNER', 'ADVANCED'] } },
  });
  expect(s.schema.required).toEqual(['id', 'level']);
  expect(notes).toEqual(['Student.geo: skipped unsupported type "Unsupported"']);
});
test('graphql importer maps enums and notes custom scalars', () => {
  const src = `scalar DateTime enum Level { BEGINNER ADVANCED } type Student { level: Level! born: DateTime }`;
  const notes: string[] = [];
  const s = importGraphql(src, 'schema', notes).find((e) => e.id === 'Student')!;
  expect(s.schema.properties).toEqual({ level: { enum: ['BEGINNER', 'ADVANCED'] } });
  expect(s.schema.required).toEqual(['level']);
  expect(notes).toEqual(['Student.born: skipped custom scalar "DateTime"']);
});
test('graphql importer notes interface/union fields as unsupported, not as scalars', () => {
  const notes: string[] = [];
  importGraphql(`interface Node { id: ID! } type Student { node: Node }`, 'schema', notes);
  expect(notes).toEqual(['Student.node: skipped unsupported type "Node"']);
});

test('json-schema importer: $refs between $defs become relationships', () => {
  const src = JSON.stringify({
    $defs: {
      PersonName: { type: 'object', properties: { given: { type: 'string' } } },
      Visit: { type: 'object', properties: { driver: { $ref: '#/$defs/PersonName' }, place: { $ref: '#/definitions/Place' } } },
      Place: { type: 'object' },
    },
  });
  const visit = importJsonSchema(src, 'x').find((e) => e.id === 'Visit')!;
  expect(visit.relationships).toEqual(['PersonName', 'Place']);
  expect(JSON.stringify(visit.schema)).not.toContain('$ref');
});
test('importers take title and summary from the schema', () => {
  const src = JSON.stringify({ $defs: { Visit: { type: 'object', title: 'Gate visit', description: 'One vehicle entering a place.' } } });
  const [v] = importJsonSchema(src, 'x');
  expect(v.title).toBe('Gate visit');
  expect(v.summary).toBe('One vehicle entering a place.');
  const [plain] = importJsonSchema(JSON.stringify({ $defs: { Place: { type: 'object' } } }), 'x');
  expect(plain.title).toBeUndefined();
});
test('json-schema importer drops a definition-level $id (Zod registry exports set "#/$defs/X")', () => {
  const src = JSON.stringify({ $defs: { Place: { $id: '#/$defs/Place', type: 'object' } } });
  const [p] = importJsonSchema(src, 'x');
  expect(p.schema.$id).toBeUndefined();
});
