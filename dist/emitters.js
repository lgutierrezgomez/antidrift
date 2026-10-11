import { compile } from 'json-schema-to-typescript';
const pascal = (s) => s.replace(/(^|[_.\-])(\w)/g, (_m, _sep, c) => c.toUpperCase());
export const tsEmitter = {
    lang: 'ts',
    ext: 'ts',
    async emit(entities) {
        const parts = [];
        for (const e of entities) {
            parts.push(await compile(e.schema, pascal(e.id), { bannerComment: '', additionalProperties: false }));
        }
        return parts.join('\n');
    },
};
export const EMITTERS = new Map([[tsEmitter.lang, tsEmitter]]);
