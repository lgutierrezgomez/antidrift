import { load as yamlLoad } from 'js-yaml';
import type { Entity } from './types.js';

export type Importer = (src: string, name: string) => Entity[];

export const sanitizeId = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '-');

const mk = (id: string, schema: Record<string, unknown>, relationships: string[] = []): Entity => ({
  id: sanitizeId(id),
  version: 1,
  hash: '',
  schema,
  ...(relationships.length ? { relationships } : {}),
});

export const importJsonSchema: Importer = (src, name) => {
  const doc = JSON.parse(src);
  const defs = doc.$defs ?? doc.definitions;
  if (defs && typeof defs === 'object') return Object.entries(defs).map(([id, schema]) => mk(id, schema as Record<string, unknown>));
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

export const IMPORTERS: Record<string, Importer> = {
  'json-schema': importJsonSchema,
  openapi: importOpenApi,
};
