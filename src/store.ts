import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 as Ajv } from 'ajv/dist/2020.js';
import type { Entity, IndexEntry } from './types.js';

const ajv = new Ajv({ strict: false });

export const storeDir = (root: string) => join(root, '.antidrift');
export const entitiesDir = (root: string) => join(storeDir(root), 'entities');
export const indexPath = (root: string) => join(storeDir(root), 'index.json');
export const ID_RE = /^[A-Za-z0-9_.-]+$/;
export const entityPath = (root: string, id: string) => {
  if (!id || !ID_RE.test(id)) throw new Error(`Invalid entity id: ${JSON.stringify(id)}`);
  return join(entitiesDir(root), `${id}.json`);
};

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',')}}`;
  }
  return JSON.stringify(v);
}

export function computeHash(schema: Record<string, unknown>): string {
  return createHash('sha256').update(canonical(schema)).digest('hex').slice(0, 12);
}

export function initStore(root: string): void {
  mkdirSync(entitiesDir(root), { recursive: true });
  if (!existsSync(indexPath(root))) writeFileSync(indexPath(root), '[]\n');
}

export function writeEntity(root: string, entity: Entity): void {
  if (!ajv.validateSchema(entity.schema)) {
    throw new Error(`Invalid JSON Schema for "${entity.id}": ${ajv.errorsText(ajv.errors)}`);
  }
  mkdirSync(entitiesDir(root), { recursive: true });
  writeFileSync(entityPath(root, entity.id), JSON.stringify(entity, null, 2) + '\n');
}

export const readEntity = (root: string, id: string): Entity =>
  JSON.parse(readFileSync(entityPath(root, id), 'utf8')) as Entity;

export function listEntityIds(root: string): string[] {
  if (!existsSync(entitiesDir(root))) return [];
  return readdirSync(entitiesDir(root)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
}

export function reconcileEntity(root: string, id: string): Entity {
  const e = readEntity(root, id);
  const hash = computeHash(e.schema);
  if (e.hash === '') {
    // First reconcile: stamp the hash, keep the authored version.
    e.hash = hash;
    writeEntity(root, e);
  } else if (hash !== e.hash) {
    e.version += 1;
    e.hash = hash;
    writeEntity(root, e);
  }
  return e;
}

/** Pure read: compute the index from entity files without writing anything. */
export function computeIndex(root: string): IndexEntry[] {
  if (!existsSync(entitiesDir(root))) return [];
  return listEntityIds(root).map((id) => {
    const e = readEntity(root, id);
    return { id: e.id, title: e.title ?? e.id, version: e.version, hash: e.hash, summary: e.summary ?? '', file: `entities/${id}.json` };
  });
}

/** Compute the index AND persist it to index.json. Use after an entity changes. */
export function buildIndex(root: string): IndexEntry[] {
  const index = computeIndex(root);
  if (existsSync(entitiesDir(root))) writeFileSync(indexPath(root), JSON.stringify(index, null, 2) + '\n');
  return index;
}

export function readIndex(root: string): IndexEntry[] {
  return existsSync(indexPath(root)) ? (JSON.parse(readFileSync(indexPath(root), 'utf8')) as IndexEntry[]) : [];
}

export const readAllEntities = (root: string): Entity[] => listEntityIds(root).map((id) => readEntity(root, id));
