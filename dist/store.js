import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 as Ajv } from 'ajv/dist/2020.js';
const ajv = new Ajv({ strict: false });
export const storeDir = (root) => join(root, '.antidrift');
export const entitiesDir = (root) => join(storeDir(root), 'entities');
export const indexPath = (root) => join(storeDir(root), 'index.json');
export const entityPath = (root, id) => join(entitiesDir(root), `${id}.json`);
function canonical(v) {
    if (Array.isArray(v))
        return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') {
        const o = v;
        return `{${Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',')}}`;
    }
    return JSON.stringify(v);
}
export function computeHash(schema) {
    return createHash('sha256').update(canonical(schema)).digest('hex').slice(0, 12);
}
export function initStore(root) {
    mkdirSync(entitiesDir(root), { recursive: true });
    if (!existsSync(indexPath(root)))
        writeFileSync(indexPath(root), '[]\n');
}
export function writeEntity(root, entity) {
    if (!ajv.validateSchema(entity.schema)) {
        throw new Error(`Invalid JSON Schema for "${entity.id}": ${ajv.errorsText(ajv.errors)}`);
    }
    mkdirSync(entitiesDir(root), { recursive: true });
    writeFileSync(entityPath(root, entity.id), JSON.stringify(entity, null, 2) + '\n');
}
export const readEntity = (root, id) => JSON.parse(readFileSync(entityPath(root, id), 'utf8'));
export function listEntityIds(root) {
    if (!existsSync(entitiesDir(root)))
        return [];
    return readdirSync(entitiesDir(root)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
}
export function reconcileEntity(root, id) {
    const e = readEntity(root, id);
    const hash = computeHash(e.schema);
    if (e.hash === '') {
        // First reconcile: stamp the hash, keep the authored version.
        e.hash = hash;
        writeEntity(root, e);
    }
    else if (hash !== e.hash) {
        e.version += 1;
        e.hash = hash;
        writeEntity(root, e);
    }
    return e;
}
export function buildIndex(root) {
    if (!existsSync(entitiesDir(root)))
        return [];
    const index = listEntityIds(root).map((id) => {
        const e = readEntity(root, id);
        return { id: e.id, title: e.title ?? e.id, version: e.version, hash: e.hash, summary: e.summary ?? '', file: `entities/${id}.json` };
    });
    writeFileSync(indexPath(root), JSON.stringify(index, null, 2) + '\n');
    return index;
}
export function readIndex(root) {
    return existsSync(indexPath(root)) ? JSON.parse(readFileSync(indexPath(root), 'utf8')) : [];
}
