import { load as yamlLoad } from 'js-yaml';
import { parse, Kind } from 'graphql';
import { computeHash } from './store.js';
export const sanitizeId = (s) => s.replace(/[^A-Za-z0-9_.-]/g, '-');
/** Replace any `$ref` node with a self-contained schema. Internal refs would break
 * per-entity compilation; external refs (file://, http://) would leak on resolution. */
export function stripRefs(node) {
    if (Array.isArray(node))
        return node.map(stripRefs);
    if (node && typeof node === 'object') {
        if ('$ref' in node)
            return { type: 'object' };
        const out = {};
        for (const [k, v] of Object.entries(node))
            out[k] = stripRefs(v);
        return out;
    }
    return node;
}
/** A fresh entity at @1 with its hash already stamped, titled/summarized from the schema when it says. */
const mk = (id, schema, relationships = []) => {
    // A definition becomes its own document, so its old `$id` (often "#/$defs/X", invalid on its own) goes.
    const { $id: _id, ...rest } = schema;
    const clean = stripRefs(rest);
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
const DEFS_REF = /^#\/(?:\$defs|definitions)\/([^/]+)/;
const OPENAPI_REF = /^#\/components\/schemas\/([^/]+)/;
export const importJsonSchema = (src, name, notes = []) => {
    const doc = JSON.parse(src);
    const defs = doc.$defs ?? doc.definitions;
    if (defs && typeof defs === 'object')
        return Object.entries(defs).map(([id, schema]) => mk(id, schema, relationshipsOf(id, schema, DEFS_REF, notes)));
    return [mk(name, doc)];
};
const decodePointer = (s) => {
    let d = s.replace(/~1/g, '/').replace(/~0/g, '~');
    try {
        d = decodeURIComponent(d);
    }
    catch {
        /* keep as is */
    }
    return d;
};
/**
 * Entity ids referenced through `$ref`s that point at a sibling definition (`prefix` + name, deeper
 * pointers count as the definition itself). Refs to other documents can't become relationships; they
 * are listed in `external`.
 */
function collectRefs(node, prefix, out, external) {
    if (Array.isArray(node))
        node.forEach((n) => collectRefs(n, prefix, out, external));
    else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
            if (k === '$ref' && typeof v === 'string') {
                const m = v.match(prefix);
                if (m)
                    out.add(sanitizeId(decodePointer(m[1])));
                else if (!v.startsWith('#'))
                    external.add(v);
            }
            else
                collectRefs(v, prefix, out, external);
        }
    }
}
/** Relationships for one definition (minus itself), noting refs it can't follow. */
function relationshipsOf(id, schema, prefix, notes) {
    const refs = new Set();
    const external = new Set();
    collectRefs(schema, prefix, refs, external);
    refs.delete(sanitizeId(id));
    for (const x of external)
        notes.push(`${sanitizeId(id)}: external $ref not followed: ${x}`);
    return [...refs];
}
export const importOpenApi = (src, _name, notes = []) => {
    const doc = (src.trimStart().startsWith('{') ? JSON.parse(src) : yamlLoad(src));
    const schemas = doc?.components?.schemas ?? {};
    return Object.entries(schemas).map(([id, schema]) => mk(id, schema, relationshipsOf(id, schema, OPENAPI_REF, notes)));
};
const PRISMA_SCALAR = {
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
export const importPrisma = (src, _name, notes = []) => {
    const models = [...src.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)];
    const names = new Set(models.map((m) => m[1]));
    const enums = new Map([...src.matchAll(/enum\s+(\w+)\s*\{([^}]*)\}/g)].map(([, n, body]) => [
        n,
        body.split('\n').map((l) => l.trim().match(/^(\w+)/)?.[1]).filter((v) => !!v),
    ]));
    return models.map(([, name, body]) => {
        const properties = {};
        const required = [];
        const relationships = [];
        for (const raw of body.split('\n')) {
            const m = raw.trim().match(/^(\w+)\s+(\w+)(\[\])?(\?)?/);
            if (!m)
                continue;
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
            if (!opt && !arr)
                required.push(field);
        }
        const schema = { type: 'object', properties };
        if (required.length)
            schema.required = required;
        return mk(name, schema, relationships);
    });
};
const GQL_SCALAR = { String: 'string', ID: 'string', Int: 'integer', Float: 'number', Boolean: 'boolean' };
function unwrapGql(t) {
    let required = false;
    let list = false;
    let node = t;
    if (node.kind === Kind.NON_NULL_TYPE) {
        required = true;
        node = node.type;
    }
    if (node.kind === Kind.LIST_TYPE) {
        list = true;
        node = node.type;
        if (node.kind === Kind.NON_NULL_TYPE)
            node = node.type;
    }
    return { name: node.kind === Kind.NAMED_TYPE ? node.name.value : '', required, list };
}
export const importGraphql = (src, _name, notes = []) => {
    const doc = parse(src);
    const enums = new Map();
    const scalars = new Set();
    for (const d of doc.definitions) {
        if (d.kind === Kind.ENUM_TYPE_DEFINITION)
            enums.set(d.name.value, (d.values ?? []).map((v) => v.name.value));
        if (d.kind === Kind.SCALAR_TYPE_DEFINITION)
            scalars.add(d.name.value);
    }
    const objs = doc.definitions.filter((d) => d.kind === Kind.OBJECT_TYPE_DEFINITION || d.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION);
    const names = new Set(objs.map((d) => d.name.value));
    return objs.map((def) => {
        const properties = {};
        const required = [];
        const relationships = [];
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
            if (u.required && !u.list)
                required.push(f.name.value);
        }
        const schema = { type: 'object', properties };
        if (required.length)
            schema.required = required;
        return mk(def.name.value, schema, relationships);
    });
};
export const IMPORTERS = {
    'json-schema': importJsonSchema,
    openapi: importOpenApi,
    prisma: importPrisma,
    graphql: importGraphql,
};
