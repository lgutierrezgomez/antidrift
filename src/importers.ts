import { load as yamlLoad } from 'js-yaml';
import { parse, Kind, type TypeNode } from 'graphql';
import type { Entity } from './types.js';
import { computeHash } from './store.js';

/** `notes` collects human-readable warnings about input that was skipped. */
export type Importer = (src: string, name: string, notes?: string[]) => Entity[];

export const sanitizeId = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '-');

/** Replace any `$ref` node with a self-contained schema. Internal refs would break
 * per-entity compilation; external refs (file://, http://) would leak on resolution. */
export function stripRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripRefs);
  if (node && typeof node === 'object') {
    if ('$ref' in (node as Record<string, unknown>)) return { type: 'object' };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = stripRefs(v);
    return out;
  }
  return node;
}

/** A fresh entity at @1 with its hash already stamped, titled/summarized from the schema when it says. */
const mk = (id: string, schema: Record<string, unknown>, relationships: string[] = []): Entity => {
  const clean = stripRefs(schema) as Record<string, unknown>;
  return {
    id: sanitizeId(id),
    version: 1,
    hash: computeHash(clean),
    ...(typeof schema.title === 'string' && schema.title.trim() ? { title: schema.title.trim() } : {}),
    ...(typeof schema.description === 'string' && schema.description.trim() ? { summary: schema.description.trim() } : {}),
    schema: clean,
    ...(relationships.length ? { relationships } : {}),
  };
};

export const importJsonSchema: Importer = (src, name) => {
  const doc = JSON.parse(src);
  const defs = doc.$defs ?? doc.definitions;
  if (defs && typeof defs === 'object')
    return Object.entries(defs).map(([id, schema]) => {
      const refs = new Set<string>();
      collectRefs(schema, refs);
      refs.delete(id);
      return mk(id, schema as Record<string, unknown>, [...refs].map(sanitizeId));
    });
  return [mk(name, doc)];
};

function collectRefs(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') {
        const m = v.match(/\/([^/]+)$/);
        if (m) out.add(m[1]);
      } else collectRefs(v, out);
    }
  }
}

export const importOpenApi: Importer = (src) => {
  const doc = (src.trimStart().startsWith('{') ? JSON.parse(src) : yamlLoad(src)) as {
    components?: { schemas?: Record<string, Record<string, unknown>> };
  };
  const schemas = doc?.components?.schemas ?? {};
  return Object.entries(schemas).map(([id, schema]) => {
    const refs = new Set<string>();
    collectRefs(schema, refs);
    refs.delete(id);
    return mk(id, schema, [...refs].map(sanitizeId));
  });
};

const PRISMA_SCALAR: Record<string, string> = {
  String: 'string',
  Int: 'integer',
  BigInt: 'integer',
  Float: 'number',
  Decimal: 'number',
  Boolean: 'boolean',
  DateTime: 'string',
  Json: 'object',
  Bytes: 'string',
};

export const importPrisma: Importer = (src, _name, notes = []) => {
  const models = [...src.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)];
  const names = new Set(models.map((m) => m[1]));
  const enums = new Map(
    [...src.matchAll(/enum\s+(\w+)\s*\{([^}]*)\}/g)].map(([, n, body]) => [
      n,
      body.split('\n').map((l) => l.trim().match(/^(\w+)/)?.[1]).filter((v): v is string => !!v),
    ]),
  );
  return models.map(([, name, body]) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const relationships: string[] = [];
    for (const raw of body.split('\n')) {
      const m = raw.trim().match(/^(\w+)\s+(\w+)(\[\])?(\?)?/);
      if (!m) continue;
      const [, field, type, arr, opt] = m;
      if (names.has(type)) {
        relationships.push(sanitizeId(type));
        continue;
      }
      const item = enums.has(type) ? { enum: enums.get(type) } : PRISMA_SCALAR[type] ? { type: PRISMA_SCALAR[type] } : null;
      if (!item) {
        notes.push(`${name}.${field}: skipped unsupported type "${type}"`);
        continue;
      }
      properties[field] = arr ? { type: 'array', items: item } : item;
      if (!opt && !arr) required.push(field);
    }
    const schema: Record<string, unknown> = { type: 'object', properties };
    if (required.length) schema.required = required;
    return mk(name, schema, relationships);
  });
};

const GQL_SCALAR: Record<string, string> = { String: 'string', ID: 'string', Int: 'integer', Float: 'number', Boolean: 'boolean' };

function unwrapGql(t: TypeNode): { name: string; required: boolean; list: boolean } {
  let required = false;
  let list = false;
  let node: TypeNode = t;
  if (node.kind === Kind.NON_NULL_TYPE) {
    required = true;
    node = node.type;
  }
  if (node.kind === Kind.LIST_TYPE) {
    list = true;
    node = node.type;
    if (node.kind === Kind.NON_NULL_TYPE) node = node.type;
  }
  return { name: node.kind === Kind.NAMED_TYPE ? node.name.value : '', required, list };
}

export const importGraphql: Importer = (src, _name, notes = []) => {
  const doc = parse(src);
  const enums = new Map<string, string[]>();
  const scalars = new Set<string>();
  for (const d of doc.definitions) {
    if (d.kind === Kind.ENUM_TYPE_DEFINITION) enums.set(d.name.value, (d.values ?? []).map((v) => v.name.value));
    if (d.kind === Kind.SCALAR_TYPE_DEFINITION) scalars.add(d.name.value);
  }
  const objs = doc.definitions.filter(
    (d) => d.kind === Kind.OBJECT_TYPE_DEFINITION || d.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION,
  ) as Array<{ name: { value: string }; fields?: ReadonlyArray<{ name: { value: string }; type: TypeNode }> }>;
  const names = new Set(objs.map((d) => d.name.value));
  return objs.map((def) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const relationships: string[] = [];
    for (const f of def.fields ?? []) {
      const u = unwrapGql(f.type);
      if (names.has(u.name)) {
        relationships.push(sanitizeId(u.name));
        continue;
      }
      const item = enums.has(u.name) ? { enum: enums.get(u.name) } : GQL_SCALAR[u.name] ? { type: GQL_SCALAR[u.name] } : null;
      if (!item) {
        const kind = scalars.has(u.name) ? 'custom scalar' : 'unsupported type';
        notes.push(`${def.name.value}.${f.name.value}: skipped ${kind} "${u.name}"`);
        continue;
      }
      properties[f.name.value] = u.list ? { type: 'array', items: item } : item;
      if (u.required && !u.list) required.push(f.name.value);
    }
    const schema: Record<string, unknown> = { type: 'object', properties };
    if (required.length) schema.required = required;
    return mk(def.name.value, schema, relationships);
  });
};

export const IMPORTERS: Record<string, Importer> = {
  'json-schema': importJsonSchema,
  openapi: importOpenApi,
  prisma: importPrisma,
  graphql: importGraphql,
};
