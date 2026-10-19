import { compile } from 'json-schema-to-typescript';
const pascal = (s) => s.replace(/(^|[_.\-])(\w)/g, (_m, _sep, c) => c.toUpperCase());
// json-schema-to-typescript honors these keywords by emitting raw TS verbatim — a code-injection
// vector when entity schemas come from untrusted imports. Strip them before compiling.
const UNSAFE_KEYS = new Set(['tsType', 'tsEnumNames']);
function sanitizeForCompile(node) {
    if (Array.isArray(node))
        return node.map(sanitizeForCompile);
    if (node && typeof node === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(node))
            if (!UNSAFE_KEYS.has(k))
                out[k] = sanitizeForCompile(v);
        return out;
    }
    return node;
}
const words = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);
/** Every `enum` in a schema, keyed by its property path (array `items` and anyOf/oneOf/allOf keep the path). */
function collectEnums(node, path, out) {
    if (!node || typeof node !== 'object' || Array.isArray(node))
        return;
    const n = node;
    if (Array.isArray(n.enum))
        out.push({ path, values: n.enum });
    if (n.properties && typeof n.properties === 'object')
        for (const [k, v] of Object.entries(n.properties))
            collectEnums(v, [...path, k], out);
    collectEnums(n.items, path, out);
    for (const key of ['anyOf', 'oneOf', 'allOf'])
        if (Array.isArray(n[key]))
            for (const v of n[key])
                collectEnums(v, path, out);
}
function emitTsEnums(entities) {
    const seen = new Set();
    const lines = [];
    for (const e of entities) {
        const found = [];
        collectEnums(e.schema, [e.id], found);
        for (const { path, values } of found) {
            const w = path.flatMap(words);
            const baseName = w.map((x) => x.toUpperCase()).join('_').replace(/^(\d)/, '_$1');
            const baseType = w.map((x) => x[0].toUpperCase() + x.slice(1)).join('').replace(/^(\d)/, '_$1');
            let [name, type] = [baseName, baseType];
            for (let i = 2; seen.has(name); i++)
                [name, type] = [`${baseName}_${i}`, `${baseType}${i}`];
            seen.add(name);
            // JSON literals are valid TS literals, so values can't break out of the array.
            lines.push(`export const ${name} = ${JSON.stringify(values)} as const;`);
            lines.push(`export type ${type} = (typeof ${name})[number];`);
        }
    }
    return lines.length ? lines.join('\n') + '\n' : 'export {};\n';
}
export const tsEmitter = {
    lang: 'ts',
    ext: 'ts',
    async emit(entities) {
        const parts = [];
        for (const e of entities) {
            parts.push(await compile(sanitizeForCompile(e.schema), pascal(e.id), {
                bannerComment: '',
                additionalProperties: false,
                // Never resolve external refs — importer input is untrusted (no file read / SSRF).
                $refOptions: { resolve: { file: false, http: false } },
            }));
        }
        return parts.join('\n');
    },
    emitEnums: emitTsEnums,
};
export const EMITTERS = new Map([[tsEmitter.lang, tsEmitter]]);
