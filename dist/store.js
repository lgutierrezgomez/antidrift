import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 as Ajv } from 'ajv/dist/2020.js';
import { componentsDir, listComponentIds, readComponent } from './ui/components.js';
const ajv = new Ajv({ strict: false });
export const storeDir = (root) => join(root, '.antidrift');
export const entitiesDir = (root) => join(storeDir(root), 'entities');
export const indexPath = (root) => join(storeDir(root), 'index.json');
export const ID_RE = /^[A-Za-z0-9_.-]+$/;
export const entityPath = (root, id) => {
    if (!id || !ID_RE.test(id) || /^\.+$/.test(id))
        throw new Error(`Invalid entity id: ${JSON.stringify(id)}`);
    return join(entitiesDir(root), `${id}.json`);
};
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
export function assertValidSchema(id, schema) {
    if (!ajv.validateSchema(schema)) {
        throw new Error(`Invalid JSON Schema for "${id}": ${ajv.errorsText(ajv.errors)}`);
    }
}
export function writeEntity(root, entity) {
    assertValidSchema(entity.id, entity.schema);
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
/** Pure read: compute the index from entity (then component) files without writing anything. */
export function computeIndex(root) {
    const entities = listEntityIds(root).map((id) => {
        const e = readEntity(root, id);
        return { id: e.id, title: e.title ?? e.id, version: e.version, hash: e.hash, summary: e.summary ?? '', file: `entities/${id}.json` };
    });
    const components = listComponentIds(root).map((id) => {
        const c = readComponent(root, id);
        return { id: c.id, title: c.title ?? c.id, version: c.version, hash: c.hash, summary: c.summary ?? '', file: `components/${id}.json`, kind: 'component' };
    });
    return [...entities, ...components];
}
/** Compute the index AND persist it to index.json. Use after an entity changes. */
export function buildIndex(root) {
    const index = computeIndex(root);
    if (existsSync(entitiesDir(root)) || existsSync(componentsDir(root)))
        writeFileSync(indexPath(root), JSON.stringify(index, null, 2) + '\n');
    return index;
}
export function readIndex(root) {
    return existsSync(indexPath(root)) ? JSON.parse(readFileSync(indexPath(root), 'utf8')) : [];
}
export const readAllEntities = (root) => listEntityIds(root).map((id) => readEntity(root, id));
