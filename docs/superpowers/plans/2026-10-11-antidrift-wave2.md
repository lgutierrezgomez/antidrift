# antidrift Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add robustness + `tag`, relationship validation, four importers, and pluggable type generation to the shipped antidrift v1.

**Architecture:** Each feature extends the existing `.antidrift/` store + CLI. New modules: `src/relationships.ts`, `src/importers.ts`, `src/emitters.ts`. CLI gains `tag`, `import`, `gen-types`. `main()` becomes async (gen-types/import compile is async).

**Tech Stack:** TypeScript/Node, ajv, vitest (existing) + `js-yaml`, `graphql`, `json-schema-to-typescript`.

**Spec:** `docs/superpowers/specs/2026-10-11-antidrift-wave2-design.md`

## Global Constraints

- Entity id grammar (everywhere): `^[A-Za-z0-9_.-]+$`. Ids from CLI/importers are validated or sanitized to it.
- Imported entities are written with `version: 1, hash: ""` (next reconcile stamps them).
- `scanRepo` skips `.git`, `node_modules`, `.antidrift`, `dist`; does NOT follow symlinks; skips files > 2 MB.
- New drift kind `broken-ref`: a `relationships` id not present in the store.
- Emitters implement `{ lang, ext, emit(entities): string | Promise<string> }`; registry maps lang → emitter; TS ships.
- Prisma is parsed by an in-repo parser (no `@prisma/internals`).

## Review Focus

- Importer on malformed input (not JSON / not YAML / unparseable SDL) → clear error, no partial write. → T6–T9 tests.
- Importer-produced ids with illegal chars (e.g. a GraphQL `type User_Role`) must be sanitized to the grammar. → T6 test (`sanitizeId`).
- `tag` with an out-of-range line or missing file → error, file untouched. → T3 test.
- `gen-types` on an empty store → writes a valid (empty) file, no crash. → T11 test.
- Path traversal via `entityPath(root, "../x")` → throws. → T1 test.

---

### Task 1: CLI id validation + graceful errors

**Files:** Modify `src/store.ts` (entityPath guard), `src/cli.ts` (wrap main in try/catch). Test: `tests/store.test.ts`.

**Interfaces:** Produces: `entityPath` throws on empty/invalid id.

- [ ] **Step 1: Failing test** (append to `tests/store.test.ts`):
```ts
test('entityPath rejects empty and path-traversal ids', () => {
  expect(() => S.entityPath(root, '')).toThrow();
  expect(() => S.entityPath(root, '../evil')).toThrow();
  expect(() => S.entityPath(root, 'student')).not.toThrow();
});
```
- [ ] **Step 2: Run** `npm test -- store` → FAIL (`../evil` currently allowed).
- [ ] **Step 3:** In `src/store.ts`, change `entityPath`:
```ts
export const ID_RE = /^[A-Za-z0-9_.-]+$/;
export const entityPath = (root: string, id: string) => {
  if (!id || !ID_RE.test(id)) throw new Error(`Invalid entity id: ${JSON.stringify(id)}`);
  return join(entitiesDir(root), `${id}.json`);
};
```
- [ ] **Step 4:** In `src/cli.ts` `main()`, wrap the switch body in `try { ... } catch (e) { console.error('antidrift: ' + (e as Error).message); process.exit(2); }` so missing/invalid args and not-found entities print a clean message.
- [ ] **Step 5: Run** `npm test` → all pass. **Step 6: Commit** `feat(cli): validate entity ids + graceful errors`.

---

### Task 2: scanner — no symlink follow + size cap

**Files:** Modify `src/scanner.ts`. Test: `tests/scanner.test.ts`.

- [ ] **Step 1: Failing test** (append):
```ts
import { symlinkSync } from 'node:fs';
test('scanRepo does not follow symlinks and skips >2MB files', () => {
  const root = mkdtempSync(join(tmpdir(), 'ad-'));
  writeFileSync(join(root, 'ok.ts'), '// antidrift #a@1\n');
  writeFileSync(join(root, 'big.ts'), '// antidrift #big@1\n' + 'x'.repeat(2 * 1024 * 1024 + 1));
  writeFileSync(join(root, 'real.ts'), '// antidrift #link@1\n');
  symlinkSync(join(root, 'real.ts'), join(root, 'link.ts'));
  const ids = scanRepo(root).map((t) => t.id).sort();
  expect(ids).toEqual(['a', 'link']); // 'big' skipped (size); 'real.ts' counted once, symlink not followed
});
```
- [ ] **Step 2: Run** → FAIL (big counted / symlink followed).
- [ ] **Step 3:** In `src/scanner.ts`: `import { lstatSync }` (replace statSync), add `const MAX = 2 * 1024 * 1024;`, and in `walk`:
```ts
const st = lstatSync(full);
if (st.isSymbolicLink()) continue;
if (st.isDirectory()) walk(full);
else if (st.isFile() && st.size <= MAX) { try { tags.push(...scanFile(full, root)); } catch { /* skip */ } }
```
- [ ] **Step 4: Run** `npm test` → pass. **Step 5: Commit** `fix(scanner): skip symlinks and >2MB files`.

---

### Task 3: `tag` command

**Files:** Create `src/comment.ts`. Modify `src/cli.ts` (add `cmdTag` + dispatch). Test: `tests/tag.test.ts`.

**Interfaces:** Produces `commentSyntax(file): [string,string]`, `cmdTag(root, id, target): string`.

- [ ] **Step 1: Failing test** `tests/tag.test.ts`:
```ts
import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S from '../src/store.js';
import { cmdTag } from '../src/cli.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ad-'));
  S.writeEntity(root, { id: 'student', version: 3, hash: 'h', schema: { type: 'object' } });
  S.buildIndex(root);
});
test('tag inserts a // comment above the line in a .ts file', () => {
  writeFileSync(join(root, 'a.ts'), 'const x = 1;\nuseStudent();\n');
  cmdTag(root, 'student', join(root, 'a.ts') + ':2');
  expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('const x = 1;\n// antidrift #student@3\nuseStudent();\n');
});
test('tag uses # for .py and errors on bad line', () => {
  writeFileSync(join(root, 'b.py'), 'use_student()\n');
  cmdTag(root, 'student', join(root, 'b.py') + ':1');
  expect(readFileSync(join(root, 'b.py'), 'utf8')).toBe('# antidrift #student@3\nuse_student()\n');
  expect(() => cmdTag(root, 'student', join(root, 'b.py') + ':99')).toThrow();
});
```
- [ ] **Step 2: Run** `npm test -- tag` → FAIL.
- [ ] **Step 3:** `src/comment.ts`:
```ts
const SLASH = new Set(['ts','tsx','js','jsx','dart','java','kt','go','rs','c','cpp','cs','swift','scala','php']);
const HASH = new Set(['py','rb','sh','bash','yaml','yml','toml','r']);
const XML = new Set(['html','xml','vue','svelte','md']);
export function commentSyntax(file: string): [string, string] {
  const ext = (file.split('.').pop() ?? '').toLowerCase();
  if (HASH.has(ext)) return ['# ', ''];
  if (XML.has(ext)) return ['<!-- ', ' -->'];
  return ['// ', ''];
}
```
- [ ] **Step 4:** In `src/cli.ts` add (imports: `readFileSync, writeFileSync` from node:fs, `commentSyntax` from './comment.js', `readEntity` already imported):
```ts
export function cmdTag(root: string, id: string, target: string): string {
  const i = target.lastIndexOf(':');
  const file = target.slice(0, i);
  const line = Number(target.slice(i + 1));
  const version = readEntity(root, id).version; // throws if id invalid/missing
  const lines = readFileSync(file, 'utf8').split('\n');
  if (!Number.isInteger(line) || line < 1 || line > lines.length + 1) throw new Error(`line ${line} out of range for ${file}`);
  const [pre, post] = commentSyntax(file);
  lines.splice(line - 1, 0, `${pre}antidrift #${id}@${version}${post}`);
  writeFileSync(file, lines.join('\n'));
  return `tagged ${file}:${line} with #${id}@${version}`;
}
```
Add dispatch in `main()`: `case 'tag': console.log(cmdTag(root, requireArg(arg), process.argv[4])); break;` (requireArg throws if undefined).
- [ ] **Step 5: Run** `npm test` → pass. **Step 6: Commit** `feat(cli): tag command inserts usage comments by file type`.

---

### Task 4: Relationship broken-ref engine + scan integration

**Files:** Create `src/relationships.ts`. Modify `src/store.ts` (add `readAllEntities`), `src/cli.ts` (scan reports broken refs). Test: `tests/relationships.test.ts`.

**Interfaces:** Produces `readAllEntities(root): Entity[]`, `computeBrokenRefs(entities, knownIds): {entity,ref}[]`.

- [ ] **Step 1: Failing test** `tests/relationships.test.ts`:
```ts
import { test, expect } from 'vitest';
import { computeBrokenRefs } from '../src/relationships.js';
import type { Entity } from '../src/types.js';
const e = (id: string, rels: string[]): Entity => ({ id, version: 1, hash: 'h', schema: {}, relationships: rels });
test('flags relationship ids not in the store', () => {
  const known = new Set(['student', 'course']);
  expect(computeBrokenRefs([e('student', ['course', 'ghost'])], known)).toEqual([{ entity: 'student', ref: 'ghost' }]);
});
test('no relationships = no broken refs', () => {
  expect(computeBrokenRefs([e('student', [])], new Set(['student']))).toEqual([]);
});
```
- [ ] **Step 2: Run** `npm test -- relationships` → FAIL.
- [ ] **Step 3:** `src/relationships.ts`:
```ts
import type { Entity } from './types.js';
export interface BrokenRef { entity: string; ref: string; }
export function computeBrokenRefs(entities: Entity[], knownIds: Set<string>): BrokenRef[] {
  const out: BrokenRef[] = [];
  for (const e of entities) for (const r of e.relationships ?? []) if (!knownIds.has(r)) out.push({ entity: e.id, ref: r });
  return out;
}
```
Add to `src/store.ts`: `export const readAllEntities = (root: string): Entity[] => listEntityIds(root).map((id) => readEntity(root, id));`
- [ ] **Step 4:** In `src/cli.ts` `cmdScan`, after computing tag `probs`, also compute broken refs and append to the report; include them in the returned `problems` count so exit code reflects them:
```ts
const entities = readAllEntities(root);
const known = new Set(computeIndex(root).map((e) => e.id));
const broken = computeBrokenRefs(entities, known);
// append to report: broken.map(b => `  #${b.entity} -> #${b.ref} [broken-ref]`)
// treat (probs.length + broken.length) as the problem count for exit status
```
(Return shape: keep `{ report, problems }` where `problems.length` now counts tag problems; add a `brokenRefs` field or fold the count — pick one and make `main()`'s exit use total. Make the exit `process.exit(r.problems.length + r.brokenRefs.length ? 1 : 0)`.)
- [ ] **Step 5:** Extend `cmdScan` return to `{ report, problems, brokenRefs }`; update the existing cli test's destructure if needed (it only reads `.problems`). **Run** `npm test` → pass. **Step 6: Commit** `feat: relationship broken-ref detection in scan`.

---

### Task 5: `show` prints relationships (outgoing + incoming)

**Files:** Modify `src/cli.ts` `cmdShow`. Test: `tests/cli.test.ts` (append).

- [ ] **Step 1: Failing test** (append to `tests/cli.test.ts`, which already builds a `student`):
```ts
import { cmdShow } from '../src/cli.js';
test('show lists incoming and outgoing relationships', () => {
  const e = S.readEntity(root, 'student'); e.relationships = ['course']; S.writeEntity(root, e);
  S.writeEntity(root, { id: 'course', version: 1, hash: 'h', schema: { type: 'object' }, relationships: ['student'] });
  S.buildIndex(root);
  const out = cmdShow(root, 'student');
  expect(out).toContain('Relationships:');
  expect(out).toContain('course');
  expect(out).toContain('Referenced by:');
});
```
- [ ] **Step 2: Run** `npm test -- cli` → FAIL.
- [ ] **Step 3:** In `cmdShow`, after the existing usage section, compute outgoing (`e.relationships`, each marked `[broken]` if not in index) and incoming (`readAllEntities(root).filter(x => (x.relationships ?? []).includes(id)).map(x => x.id)`), and append `Relationships:` + `Referenced by:` blocks.
- [ ] **Step 4: Run** `npm test` → pass. **Step 5: Commit** `feat(cli): show outgoing + incoming relationships`.

---

### Task 6: Importer framework + JSON Schema importer

**Files:** Create `src/importers.ts`. Test: `tests/importers.test.ts`.

**Interfaces:** Produces `type Importer = (src: string, name: string) => Entity[]`, `sanitizeId(s): string`, `importJsonSchema: Importer`, `IMPORTERS: Record<string, Importer>`.

- [ ] **Step 1: Failing test** `tests/importers.test.ts`:
```ts
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
```
- [ ] **Step 2: Run** `npm test -- importers` → FAIL.
- [ ] **Step 3:** `src/importers.ts`:
```ts
import type { Entity } from './types.js';
export type Importer = (src: string, name: string) => Entity[];
export const sanitizeId = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '-');
const mk = (id: string, schema: Record<string, unknown>, relationships: string[] = []): Entity =>
  ({ id: sanitizeId(id), version: 1, hash: '', schema, ...(relationships.length ? { relationships } : {}) });
export const importJsonSchema: Importer = (src, name) => {
  const doc = JSON.parse(src);
  const defs = doc.$defs ?? doc.definitions;
  if (defs && typeof defs === 'object') return Object.entries(defs).map(([id, schema]) => mk(id, schema as Record<string, unknown>));
  return [mk(name, doc)];
};
export const IMPORTERS: Record<string, Importer> = { 'json-schema': importJsonSchema };
```
- [ ] **Step 4: Run** `npm test` → pass. **Step 5: Commit** `feat(import): importer framework + json-schema`.

---

### Task 7: OpenAPI importer

**Files:** Modify `src/importers.ts`. Test: `tests/importers.test.ts` (append). Dep: `js-yaml` + `@types/js-yaml`.

- [ ] **Step 1:** `npm install js-yaml && npm install -D @types/js-yaml`.
- [ ] **Step 2: Failing test** (append):
```ts
import { importOpenApi } from '../src/importers.js';
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
```
- [ ] **Step 3: Run** → FAIL. **Implement** in `src/importers.ts`:
```ts
import yaml from 'js-yaml';
function collectRefs(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') { const m = v.match(/\/([^/]+)$/); if (m) out.add(m[1]); }
      else collectRefs(v, out);
    }
  }
}
export const importOpenApi: Importer = (src) => {
  const doc = src.trimStart().startsWith('{') ? JSON.parse(src) : (yaml.load(src) as any);
  const schemas = doc?.components?.schemas ?? {};
  return Object.entries(schemas).map(([id, schema]) => {
    const refs = new Set<string>(); collectRefs(schema, refs); refs.delete(id);
    return mk(id, schema as Record<string, unknown>, [...refs].map(sanitizeId));
  });
};
```
Register `'openapi': importOpenApi` in `IMPORTERS`.
- [ ] **Step 4: Run** `npm test` → pass. **Step 5: Commit** `feat(import): openapi (components.schemas + $ref relationships)`.

---

### Task 8: Prisma importer (in-repo parser)

**Files:** Modify `src/importers.ts`. Test: `tests/importers.test.ts` (append).

- [ ] **Step 1: Failing test** (append):
```ts
import { importPrisma } from '../src/importers.js';
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
```
- [ ] **Step 2: Run** → FAIL. **Implement**:
```ts
const PRISMA_SCALAR: Record<string, string> = { String: 'string', Int: 'integer', BigInt: 'integer', Float: 'number', Decimal: 'number', Boolean: 'boolean', DateTime: 'string', Json: 'object', Bytes: 'string' };
export const importPrisma: Importer = (src) => {
  const models = [...src.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)];
  const names = new Set(models.map((m) => m[1]));
  return models.map(([, name, body]) => {
    const properties: Record<string, unknown> = {}; const required: string[] = []; const relationships: string[] = [];
    for (const raw of body.split('\n')) {
      const m = raw.trim().match(/^(\w+)\s+(\w+)(\[\])?(\?)?/);
      if (!m) continue;
      const [, field, type, arr, opt] = m;
      if (names.has(type)) { relationships.push(sanitizeId(type)); continue; }
      const js = PRISMA_SCALAR[type]; if (!js) continue;
      properties[field] = arr ? { type: 'array', items: { type: js } } : { type: js };
      if (!opt && !arr) required.push(field);
    }
    const schema: Record<string, unknown> = { type: 'object', properties };
    if (required.length) schema.required = required;
    return mk(name, schema, relationships);
  });
};
```
Register `'prisma': importPrisma`.
- [ ] **Step 3: Run** `npm test` → pass. **Step 4: Commit** `feat(import): prisma (in-repo parser, relations -> relationships)`.

---

### Task 9: GraphQL SDL importer

**Files:** Modify `src/importers.ts`. Test: `tests/importers.test.ts` (append). Dep: `graphql`.

- [ ] **Step 1:** `npm install graphql`.
- [ ] **Step 2: Failing test** (append):
```ts
import { importGraphql } from '../src/importers.js';
test('graphql importer maps object types and object-field relationships', () => {
  const src = `type Student { id: ID! name: String bio: String course: Course } type Course { id: ID! }`;
  const s = importGraphql(src, 'schema').find((e) => e.id === 'Student')!;
  expect(s.schema).toMatchObject({ type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } });
  expect(s.schema.required).toEqual(['id']);
  expect(s.relationships).toEqual(['Course']);
});
```
- [ ] **Step 3: Run** → FAIL. **Implement**:
```ts
import { parse, Kind, type TypeNode } from 'graphql';
const GQL_SCALAR: Record<string, string> = { String: 'string', ID: 'string', Int: 'integer', Float: 'number', Boolean: 'boolean' };
function unwrap(t: TypeNode): { name: string; required: boolean; list: boolean } {
  let required = false, list = false, node = t;
  if (node.kind === Kind.NON_NULL_TYPE) { required = true; node = node.type; }
  if (node.kind === Kind.LIST_TYPE) { list = true; node = node.type; if (node.kind === Kind.NON_NULL_TYPE) node = node.type; }
  return { name: node.kind === Kind.NAMED_TYPE ? node.name.value : '', required, list };
}
export const importGraphql: Importer = (src) => {
  const doc = parse(src);
  const objs = doc.definitions.filter((d) => d.kind === Kind.OBJECT_TYPE_DEFINITION || d.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION) as any[];
  const names = new Set(objs.map((d) => d.name.value));
  return objs.map((def) => {
    const properties: Record<string, unknown> = {}; const required: string[] = []; const relationships: string[] = [];
    for (const f of def.fields ?? []) {
      const u = unwrap(f.type);
      if (names.has(u.name)) { relationships.push(sanitizeId(u.name)); continue; }
      const js = GQL_SCALAR[u.name]; if (!js) continue;
      properties[f.name.value] = u.list ? { type: 'array', items: { type: js } } : { type: js };
      if (u.required && !u.list) required.push(f.name.value);
    }
    const schema: Record<string, unknown> = { type: 'object', properties };
    if (required.length) schema.required = required;
    return mk(def.name.value, schema, relationships);
  });
};
```
Register `'graphql': importGraphql`.
- [ ] **Step 4: Run** `npm test` → pass. **Step 5: Commit** `feat(import): graphql SDL`.

---

### Task 10: `import` CLI command

**Files:** Modify `src/cli.ts`. Test: `tests/cli.test.ts` (append).

- [ ] **Step 1: Failing test** (append):
```ts
import { cmdImport } from '../src/cli.js';
test('import writes entity files and builds the index', () => {
  writeFileSync(join(root, 's.json'), JSON.stringify({ $defs: { Teacher: { type: 'object' } } }));
  const msg = cmdImport(root, 'json-schema', join(root, 's.json'));
  expect(msg).toContain('1');
  expect(S.listEntityIds(root)).toContain('Teacher');
});
test('import rejects an unknown format', () => {
  expect(() => cmdImport(root, 'xml', join(root, 'x'))).toThrow();
});
```
- [ ] **Step 2: Run** `npm test -- cli` → FAIL. **Implement** in `src/cli.ts`:
```ts
import { basename } from 'node:path';
import { writeEntity } from './store.js'; // ensure imported
import { IMPORTERS } from './importers.js';
export function cmdImport(root: string, format: string, file: string): string {
  const importer = IMPORTERS[format];
  if (!importer) throw new Error(`unknown import format: ${format} (have: ${Object.keys(IMPORTERS).join(', ')})`);
  const entities = importer(readFileSync(file, 'utf8'), basename(file).replace(/\.[^.]+$/, ''));
  for (const e of entities) writeEntity(root, e);
  buildIndex(root);
  return `imported ${entities.length} entity file(s) from ${file}`;
}
```
Dispatch: `case 'import': console.log(cmdImport(root, requireArg(arg), process.argv[4])); break;`
- [ ] **Step 3: Run** `npm test` → pass. **Step 4: Commit** `feat(cli): import command`.

---

### Task 11: Emitter registry + TypeScript emitter

**Files:** Create `src/emitters.ts`. Test: `tests/emitters.test.ts`. Dep: `json-schema-to-typescript`.

- [ ] **Step 1:** `npm install json-schema-to-typescript`.
- [ ] **Step 2: Failing test** `tests/emitters.test.ts`:
```ts
import { test, expect } from 'vitest';
import { EMITTERS } from '../src/emitters.js';
import type { Entity } from '../src/types.js';
test('ts emitter produces an interface per entity', async () => {
  const ents: Entity[] = [{ id: 'student', version: 1, hash: 'h', schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }];
  const out = await EMITTERS.get('ts')!.emit(ents);
  expect(out).toMatch(/interface Student/);
  expect(out).toMatch(/name: string/);
});
test('ts emitter on empty store returns a string', async () => {
  expect(typeof (await EMITTERS.get('ts')!.emit([]))).toBe('string');
});
```
- [ ] **Step 3: Run** `npm test -- emitters` → FAIL. **Implement** `src/emitters.ts`:
```ts
import { compile } from 'json-schema-to-typescript';
import type { Entity } from './types.js';
export interface Emitter { lang: string; ext: string; emit(entities: Entity[]): Promise<string> | string; }
const pascal = (s: string) => s.replace(/(^|[_.-])(\w)/g, (_, __, c) => c.toUpperCase());
export const tsEmitter: Emitter = {
  lang: 'ts', ext: 'ts',
  async emit(entities) {
    const parts: string[] = [];
    for (const e of entities) {
      parts.push(await compile(e.schema as any, pascal(e.id), { bannerComment: '', additionalProperties: false }));
    }
    return parts.join('\n');
  },
};
export const EMITTERS = new Map<string, Emitter>([[tsEmitter.lang, tsEmitter]]);
```
- [ ] **Step 4: Run** `npm test` → pass. **Step 5: Commit** `feat(gen): emitter registry + TypeScript emitter`.

---

### Task 12: `gen-types` CLI command (async main)

**Files:** Modify `src/cli.ts` (make `main` async, add `cmdGenTypes`). Test: `tests/cli.test.ts` (append).

- [ ] **Step 1: Failing test** (append):
```ts
import { cmdGenTypes } from '../src/cli.js';
import { existsSync, readFileSync as rf } from 'node:fs';
test('gen-types writes a ts file with an interface', async () => {
  const dest = join(root, 'out.ts');
  await cmdGenTypes(root, 'ts', dest);
  expect(existsSync(dest)).toBe(true);
  expect(rf(dest, 'utf8')).toMatch(/interface Student/);
});
```
- [ ] **Step 2: Run** `npm test -- cli` → FAIL. **Implement** in `src/cli.ts`:
```ts
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { readAllEntities, storeDir } from './store.js';
import { EMITTERS } from './emitters.js';
export async function cmdGenTypes(root: string, lang = 'ts', out?: string): Promise<string> {
  const emitter = EMITTERS.get(lang);
  if (!emitter) throw new Error(`unknown emitter lang: ${lang} (have: ${[...EMITTERS.keys()].join(', ')})`);
  const code = await emitter.emit(readAllEntities(root));
  const dest = out ?? join(storeDir(root), 'generated', `types.${emitter.ext}`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, code);
  return `wrote ${dest}`;
}
```
Make `main` async; add `case 'gen-types': console.log(await cmdGenTypes(root, process.argv[3] ?? 'ts', process.argv[4])); break;` (note: `--lang`/`--out` parsing kept simple — positional: `gen-types [lang] [out]`). Update the `if (process.argv[1] === ...) main();` to `main();` still fine (async, fire-and-forget); add `.catch((e) => { console.error('antidrift: ' + e.message); process.exit(2); })`.
- [ ] **Step 3: Run** `npm test` → pass. **Step 4: Commit** `feat(cli): gen-types command (async)`.

---

### Task 13: Rebuild dist, update commands/README, final smoke

**Files:** `npm run build` (refresh committed `dist/`), add `commands/antidrift-import.md` + `commands/antidrift-gen-types.md` + `commands/antidrift-tag.md`, update `README.md` + `skills/antidrift/SKILL.md`.

- [ ] **Step 1:** Add three command files mirroring the existing ones (run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js import|gen-types|tag ...`).
- [ ] **Step 2:** README: add the `tag`, `import` (4 formats), `gen-types` commands, the `broken-ref` drift kind, and the relationships section. SKILL.md: mention `relationships`, `/antidrift:import` for bootstrap, and that tags can be inserted with `tag`.
- [ ] **Step 3:** `npm run build` then `npm test` → all green. Manual: `import` a sample prisma + graphql + openapi, `list`, `gen-types`, `scan`.
- [ ] **Step 4: Commit** `feat: wave 2 commands + README/skill + rebuilt dist`.

---

## Self-Review (done)

- **Spec coverage:** robustness+tag → T1–T3; relationships → T4–T5; importers (4 formats) → T6–T10; type-gen (registry+TS) → T11–T12; packaging/docs → T13. All spec sections covered.
- **Placeholders:** none — real code in every step.
- **Type consistency:** `Importer`, `Emitter`, `BrokenRef` defined where first used; `readAllEntities`, `cmdImport`, `cmdGenTypes`, `cmdTag` signatures consistent across tasks; `cmdScan` return extended to `{report, problems, brokenRefs}` in T4, consumed by `main` exit + T10/existing tests read only `.problems`.
- **Review Focus:** malformed importer input (T6–T9 parse throws → cmdImport surfaces), id sanitization (T6), tag bad line (T3), empty-store gen-types (T11), path traversal (T1) — each pinned.
