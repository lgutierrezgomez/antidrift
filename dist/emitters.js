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
};
export const EMITTERS = new Map([[tsEmitter.lang, tsEmitter]]);
