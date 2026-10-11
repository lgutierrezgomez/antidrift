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

export const IMPORTERS: Record<string, Importer> = { 'json-schema': importJsonSchema };
