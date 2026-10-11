import { load as yamlLoad } from 'js-yaml';
import { parse, Kind } from 'graphql';
export const sanitizeId = (s) => s.replace(/[^A-Za-z0-9_.-]/g, '-');
const mk = (id, schema, relationships = []) => ({
    id: sanitizeId(id),
    version: 1,
    hash: '',
    schema,
    ...(relationships.length ? { relationships } : {}),
});
export const importJsonSchema = (src, name) => {
    const doc = JSON.parse(src);
    const defs = doc.$defs ?? doc.definitions;
    if (defs && typeof defs === 'object')
        return Object.entries(defs).map(([id, schema]) => mk(id, schema));
    return [mk(name, doc)];
};
function collectRefs(node, out) {
    if (Array.isArray(node))
        node.forEach((n) => collectRefs(n, out));
    else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
            if (k === '$ref' && typeof v === 'string') {
                const m = v.match(/\/([^/]+)$/);
                if (m)
                    out.add(m[1]);
            }
            else
                collectRefs(v, out);
        }
    }
}
export const importOpenApi = (src) => {
    const doc = (src.trimStart().startsWith('{') ? JSON.parse(src) : yamlLoad(src));
    const schemas = doc?.components?.schemas ?? {};
    return Object.entries(schemas).map(([id, schema]) => {
        const refs = new Set();
        collectRefs(schema, refs);
        refs.delete(id);
        return mk(id, schema, [...refs].map(sanitizeId));
    });
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
export const importPrisma = (src) => {
    const models = [...src.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)];
    const names = new Set(models.map((m) => m[1]));
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
            const js = PRISMA_SCALAR[type];
            if (!js)
                continue; // enum / unknown — skip (documented limitation)
            properties[field] = arr ? { type: 'array', items: { type: js } } : { type: js };
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
export const importGraphql = (src) => {
    const doc = parse(src);
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
            const js = GQL_SCALAR[u.name];
            if (!js)
                continue;
            properties[f.name.value] = u.list ? { type: 'array', items: { type: js } } : { type: js };
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
